const { z } = require("zod");
const dotenv = require("dotenv");
const fs = require("fs");
const axios = require("axios");
const path = require("path");

dotenv.config({});

const GPTResponse = z.object({
  isProblem: z.boolean(),
});

const llamaApiUrl = "http://127.0.0.1:11434/api/chat";

// Extract relevant content from the message
function extractContent(message) {
  return message; // Return the message object as is, without modifications
}

async function processMessagesFromFile(filename) {
  // Extract the base name by removing "_raw.json" from the filename
  const baseName = path.basename(filename, "_raw.json");
  const outputFilePath = path.join("problems", `${baseName}.json`);

  if (!fs.existsSync("problems")) {
    fs.mkdirSync("problems", { recursive: true });
  }

  const stream = fs.createWriteStream(outputFilePath, { flags: "w" });

  try {
    const messages = JSON.parse(fs.readFileSync(filename, "utf8"));
    stream.write("[\n");

    let isFirstMessage = true;

    for (const message of messages.slice(1406)) {
      const isProblem = await isMessageAboutProblem(message.text);

      if (isProblem) {
        const extractedMessage = extractContent(message);

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

  console.log(`Problem messages saved to ${outputFilePath}`);
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
              It should have a SINGLE key "isProblem" with a boolean value.
              Nothing else should be in the response.

              Example response:
              {"isProblem": true}

              Or

              {"isProblem": false}
              `,
          },
          {
            role: "user",
            content: `Is the following message about a problem, issue, or a question for guidance?\n\n"${message}"`,
          },
        ],
      },
      responseType: "stream",
      timeout: 60000,
    });

    let responseData = "";
    let start = Date.now();
    // Listen to the data event to accumulate the streaming response
    response.data.on("data", (chunk) => {
      responseData += JSON.parse(chunk.toString()).message.content;
    });

    return new Promise((resolve, reject) => {
      response.data.on("end", () => {
        try {
          console.log({ message: message.slice(0, 192) });
          const parsedResponse = GPTResponse.parse(JSON.parse(responseData));
          console.log("Response:", parsedResponse);
          console.log("Response time:", Date.now() - start);
          resolve(parsedResponse.isProblem);
        } catch (error) {
          console.error("Error parsing streamed response:", error);
          resolve(true);
        }
      });

      // Handle stream errors
      response.data.on("error", (error) => {
        console.error("Error during streaming:", error);
        reject(false);
      });
    });
  } catch (error) {
    console.error("Error checking message with Llama 3.1");
    return true;
  }
}

// Get the filename argument from the command line
const [, , filename] = process.argv;

if (!filename) {
  console.error("Please provide a filename argument.");
  process.exit(1);
}

processMessagesFromFile(filename);
