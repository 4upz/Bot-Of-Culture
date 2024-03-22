# Description: Dockerfile for the nodejs application
# TODO: Separate into build stages and use a smaller image for production that excludes dev dependencies

# Use the official image as a base image
FROM node:18

# Set the working directory
WORKDIR /app

# Copy package.json and yarn.lock
COPY package*.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy the rest of your code
COPY . .

# Transpile TypeScript to JavaScript
RUN yarn build

# Environment affects which config variables are used. Change to dev or exclude for local development
ENV ENV=PROD

# Expose the port your app runs on
EXPOSE 8080

# Command to run your app
CMD [ "node", "dist/app.js"]
