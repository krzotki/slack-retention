const { WebClient } = require("@slack/web-api");
const { z } = require("zod");
const dotenv = require("dotenv");
const fs = require("fs");
const axios = require("axios");

dotenv.config({});

const GPTResponse = z.object({
  isProblem: z.boolean(),
});

const slackToken = process.env.SLACK_TOKEN;
const web = new WebClient(slackToken);
const channelId = process.env.SLACK_CHANNEL;

const llamaApiUrl = "http://127.0.0.1:11434/api/chat";
const filePath = "problemMessages.json";

// Convert a date to a Unix timestamp
function getUnixTimestamp(year, month, day) {
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}

// Extract relevant content from the message
function extractContent(message) {
  let textContent = message.text || "";
  const links = [];
  const attachments = message.attachments || [];

  if (message.blocks) {
    message.blocks.forEach((block) => {
      if (block.type === "rich_text") {
        block.elements.forEach((element) => {
          if (element.type === "rich_text_section") {
            element.elements.forEach((subElement) => {
              if (
                subElement.type === "text" &&
                subElement.text !== textContent
              ) {
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
  const stream = fs.createWriteStream(filePath, { flags: "w" });

  try {
    stream.write("[\n");

    const year = 2023;
    const month = 1;
    const day = 1;

    const timestamp = getUnixTimestamp(year, month, day);

    const result = await web.conversations.history({
      channel: channel,
      latest: timestamp,
      limit: 5,
    });

    let isFirstMessage = true;
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

        if (!isFirstMessage) {
          stream.write(",\n");
        } else {
          isFirstMessage = false;
        }
        stream.write(JSON.stringify(extractedMessage, null, 2));
      }
    }

    stream.write("\n]\n");
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    stream.end();
  }

  console.log(`Problem messages saved to ${filePath}`);
}

async function isMessageAboutProblem(message) {
  try {
    const response = await axios({
      method: "post",
      url: llamaApiUrl,
      data: {
        model: "llama3.1",
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that identifies whether a message is about a problem, issue, or a question for guidance.
              If the message is a pull request review request, then it is not a problem or issue. Your response should be in JSON format. 
              It shoud have a SINGLE key "isProblem" with a boolean value.
              Nothing else should be in the response.`,
          },
          {
            role: "user",
            content: `Is the following message about a problem, issue, or a question for guidance?\n\n"${message}"`,
          },
        ],
      },
      responseType: "stream",
    });

    let responseData = "";

    // Listen to the data event to accumulate the streaming response
    response.data.on("data", (chunk) => {
      responseData += JSON.parse(chunk.toString()).message.content;
    });

    // Handle the end of the stream
    return new Promise((resolve, reject) => {
      response.data.on("end", () => {
        try {
          const parsedResponse = GPTResponse.parse(JSON.parse(responseData));
          console.log({ parsedResponse });
          resolve(parsedResponse.isProblem);
        } catch (error) {
          console.error("Error parsing streamed response:", error);
          reject(false);
        }
      });

      // Handle stream errors
      response.data.on("error", (error) => {
        console.error("Error during streaming:", error);
        reject(false);
      });
    });
  } catch (error) {
    console.error("Error checking message with Llama 3.1:", error);
    return false;
  }
}

fetchMessagesWithThreads(channelId);
