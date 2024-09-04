const { WebClient } = require("@slack/web-api");
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config({});

const slackToken = process.env.SLACK_TOKEN;
const web = new WebClient(slackToken);
const channelId = process.env.SLACK_CHANNEL;

// Function to fetch replies for a thread
async function fetchReplies(channelId, threadTs) {
  try {
    const response = await web.conversations.replies({
      channel: channelId,
      ts: threadTs,
    });
    return response.messages;
  } catch (error) {
    console.error(`Error fetching replies for thread ${threadTs}:`, error);
    return [];
  }
}

// Function to fetch messages from a Slack channel
async function fetchMessages() {
  try {
    let messages = [];
    let hasMore = true;
    let cursor;
    let totalMessages = 0;

    while (hasMore) {
      console.log("Fetching messages...");
      const response = await web.conversations.history({
        channel: channelId,
        cursor: cursor,
        limit: 100,
      });

      for (const message of response.messages) {
        totalMessages++;
        console.log(`Processing message ${totalMessages}`);

        // If the message has a thread_ts, fetch its replies
        if (message.thread_ts) {
          console.log(`Fetching replies for thread ${message.thread_ts}`);
          const replies = await fetchReplies(channelId, message.thread_ts);
          message.replies = replies;
        }
        messages.push(message);
      }

      cursor = response.response_metadata.next_cursor;
      hasMore = !!cursor;
    }

    // Save messages to a JSON file
    fs.writeFileSync(`${channelId}.json`, JSON.stringify(messages, null, 2));

    console.log(`Fetched ${totalMessages} messages from the channel, including replies.`);
  } catch (error) {
    console.error("Error fetching messages:", error);
  }
}

// Execute the function
fetchMessages();
