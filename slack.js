const { WebClient } = require("@slack/web-api");
const { OpenAI } = require("openai");
const { zodResponseFormat } = require("openai/helpers/zod");
const { z } = require("zod");
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config({});

const GPTResponse = z.object({
  isProblem: z.boolean(),
});

const slackToken = process.env.SLACK_TOKEN;
const web = new WebClient(slackToken);
const channelId = process.env.SLACK_CHANNEL;
const openaiApiKey = process.env.OPEN_AI;

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

const problemMessages = [];

// Convert a date to a Unix timestamp
function getUnixTimestamp(year, month, day) {
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}

// Extract relevant content from the message
function extractContent(message) {
  let textContent = message.text || "";
  const links = [];
  const attachments = message.attachments || [];

  // Extract links and additional text content from blocks, avoiding duplication
  if (message.blocks) {
    message.blocks.forEach((block) => {
      if (block.type === "rich_text") {
        block.elements.forEach((element) => {
          if (element.type === "rich_text_section") {
            element.elements.forEach((subElement) => {
              if (subElement.type === "text" && subElement.text !== textContent) {
                // Only add subElement.text if it's not already in textContent
                if (!textContent.includes(subElement.text)) {
                  textContent += subElement.text;
                }
              } else if (subElement.type === "link") {
                links.push(subElement.url);
              }
            });
          }
        });
      }
    });
  }

  return {
    text: textContent.trim(),
    links: links,
    attachments: attachments,
    date: new Date(parseFloat(message.ts) * 1000).toISOString(),
    thread: [],
  };
}

async function fetchMessagesWithThreads(channel) {
  try {
    const year = 2023;
    const month = 1;
    const day = 1;

    const timestamp = getUnixTimestamp(year, month, day);

    const result = await web.conversations.history({
      channel: channel,
      latest: timestamp,
      limit: 50,
    });

    const messages = result.messages;

    for (const message of messages) {
      const isProblem = await isMessageAboutProblem(message.text);

      if (isProblem) {
        const extractedMessage = extractContent(message);

        if (message.thread_ts) {
          const threadResult = await web.conversations.replies({
            channel: channel,
            ts: message.thread_ts,
          });

          const threadMessages = threadResult.messages;

          for (const threadMessage of threadMessages) {
            if (threadMessage.ts !== message.ts) {
              const extractedThreadMessage = extractContent(threadMessage);
              extractedMessage.thread.push(extractedThreadMessage);
            }
          }
        }

        problemMessages.push(extractedMessage);
      }
    }

    saveProblemMessagesToFile(problemMessages);
  } catch (error) {
    console.error(error);
  }
}

async function isMessageAboutProblem(message) {
  try {
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that identifies whether a message is about a problem, issue or a question for guidance.
            If the message is a pull request review request, then it is not a problem or issue.
            `,
        },
        {
          role: "user",
          content: `Is the following message about a problem, issue or a question for guidance?\n\n"${message}"`,
        },
      ],
      response_format: zodResponseFormat(GPTResponse, "response"),
      temperature: 0,
    });

    const isProblem = completion.choices[0].message.parsed.isProblem;

    return isProblem;
  } catch (error) {
    console.error("Error checking message with GPT:", error);
    return false;
  }
}

function saveProblemMessagesToFile(messages) {
  const filePath = "problemMessages.json";
  fs.writeFile(filePath, JSON.stringify(messages, null, 2), (err) => {
    if (err) {
      console.error("Error saving messages to file:", err);
    } else {
      console.log(`Problem messages saved to ${filePath}`);
    }
  });
}

fetchMessagesWithThreads(channelId);
