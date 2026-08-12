module.exports = {
    apps: [{
        name: "nodejs-transcript-tool",
        script: "./index.js",
        env: {
            port: 80,
            ASSISTANT_ID: 'your-assistant-id'
        }
    }]
}