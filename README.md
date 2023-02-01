# Bot of Culture

Discord Bot curated for the Men of Culture Discord Server using Discord.JS

## Installation Requirements
If you want to run your own version of Bot of Culture locally, it's a fairly straightforward process. It requires that you set up its 4 main dependencies:
- [Node.js](https://nodejs.org/en/) >= 16 (tip: use nvm or n to manage multiple Node versions)
- A [Discord App](https://discord.com/developers/docs/getting-started) with API credentials
- A [MongoDb](https://www.mongodb.com/atlas/database) Instance for Prisma to use
- Access keys to the Movie and TV APIs
  - [The Movie Database](https://www.themoviedb.org/documentation/api)
  - [International Game Database (IGDB)](https://api-docs.igdb.com/#about) (requires Twitch app setup as well)

It may help to also have a server for you to test your bot in, but seeing as this is a Discord Bot you probably knew that already :). When setting up your Discord app, you can generate a link to invite your bot instance to your server. Instructions on how to do so can be found [here](https://discord.com/developers/docs/getting-started#installing-your-app).

The secrets for each one of these dependencies will need to live in your `.env` file in the root of project. You can use the created `env.template` as a guide for all of the values you'll need to set. (You can copy this file and rename it to `.env` for easier setup)


## Get Started
First, clone the repository using the shiny green `Code` button.

After cloning the repository, first go through the proper steps in setting up API keys and auth tokens for each respective service listed above. After doing so, create an `.env` file using the template, and set the corresponding values using their labels:
### Discord Secrets
- **DISCORD_TOKEN**: App token provided to you by Discord after creating an app using the developer portal
- **PUBLIC_KEY**: Public key also provided in Discord Developer Portal
- **App_ID**: Application ID provided in Discord Developer Portal
- **GUILD_ID**: ID of the server that you wish to test the bot in. Mainly used to deploy server-scoped commands that you wish to test before deploying them globally. See the section on [guild-scoped slash commands](https://discord.com/developers/docs/getting-started#installing-slash-commands) for more information.
### Database Secrets
- **DATABASE_URL**: The Uri of the configured MongoDB instance (make note of special key substitutions as labeled in the template if using Atlas)
### API Secrets
#### Movies/Series
- **MOVIE_TOKEN**: Movie token provided after signing up for TMDB. 
### Games
- **TWITCH_CLIENT_ID**: Client ID provided after creating an app in the Twitch dev portal
- **TWITCH_CLIENT_SECRET**: Client secret also provided in the Twitch developer portal

Once you set up your secrets, install the dependencies using your desired package manager:

NPM
``` npm
npm install
```

Yarn
``` yarn
yarn install
```

After installing the dependencies, you should be able to run the app with no problem.

## Running the App
Before running the app, it's important to note that you will need your slash commands installed to your test server in order for the server to recognize them after the bot is running.

## Database Models
Database queries and models are handled using [Prisma](https://www.prisma.io/). This is a useful ORM tool that makes modeling and generating database-related types super easy. Before running, you will need to generate these models and have Prisma connect to your MongoDb instance. You can do this by running the following command:

NPM
``` npm
npm run prisma:generate
```

Yarn
```
yarn prisma:generate
```

You should see a message when successful, and an error otherwise. Keep this in mind as any changes to data saved to the database will require updating the `prisma/prisma.schema` file and then regenerating the models to avoid type or CRUD errors.

### Slash Commands
We've made a handy dandy script to make installing slash commands easy. To install commands to your provided server via the `GUILD_ID` secret, run the following:

NPM
``` npm
npm run deploy-commands
```

Yarn
```
yarn deploy-commands
```

This will run a script that installs all of the available slash commands to the provided guild.

Slash commands are directory-based. Therefore, the installation script will go through the `src/commands` directory to install every declared command in a Typescript file with the exclusion of any `utils`, `modals`, or `buttons` folders.
Therefore, any file that contains a Slash constructor will be installed to the provided server. These files usually look similar to the following:
``` typescript
const command: SlashCommand = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
  execute: sendPongReply,
}
```

Keep aware that these will only be guild-scoped installations. Therefore these commands will not be installed outside of the server that is provided. When you're ready to deploy your bot, you can install commands globally so that they're available to use in any server that the bot is invited to. To do so, run the following command:

NPM
``` npm
npm run deploy-commands:global
```

Yarn
```
yarn deploy-commands:global
```

**IMPORTANT**: Only do this if you are absolutely ready for the commands to be used publicly and any changes have been tested thoroughly. Otherwise, users of your BoC instance may see and try to use commands that may not work.

### Running in Development Mode
After deploying your commands locally, you can run the bot in development mode by doing the following:
NPM
``` npm
npm run dev
```

Yarn
```
yarn dev
```

The bot will login using the Discord API gateway and establish both the third-party services as well as the database. The bot will also map the names of the commands to their corresponding execution function using the same file-system parsing as the deploy script. One key difference is that this mapping also includes buttons and module actions. You should see logs providing updates on each step as it happens. Once successful, you should see the following message:
`Ready! Logged in as [Your Discord-App Name]`

You can now use the bot!

## Extra Special Info
### Other Scripts
There are some other yarn/npm scripts in the `package.json` file that may come in handy during development and/or deployment:
- **build**: Compiles typescript files into production-ready javascript files into a `/dist` for production use (avoids the need for typescript dependencies when running the app).
- **start**: Mainly used for production, but runs the app using the built typescript files that are inside of the generated `/dist` folder.
- **deploy:prod**: Only necessary if using Google Cloud App Engine for deployment. Runs the gcloud command to deploy the bot as an App Engine instance. Requires App Engine setup as well as gcloud utils to be installed.

### Data Pesistence Across Commands
You may be wondering "How in the **** does this bot save data for a user such as in-progress reviews across multiple messages before it saves it to the database???"

Stress not, my friend, as this is a handy technique that is used across most bots that utilize Discord.Js. Each message and its components utilize a **custom ID** property that you can assign before sending a reply with that component. You will find in most slash command replies, such as reviews, we assign a custom ID that looks like the following:
`searchSelect_movie_12345679_4`

The information in this ID isn't random. This example includes underscore-separated containing the action step, media type, media ID (for the corresponding API), and the review score respectively. In other words, it looks like this:
`actionType_mediaType_mediaID_reviewScore`

This neat trick allows us to keep track of the in-progress review information for a user without having to save anything in-memory! That way, even if the user decides to respond to the message later, it will always save the current state of the review along with information about the media that they were reviewing. This is used throughout the app to keep track of necessary parameters before we save  information to the database. By default, Discord interactions usually contains other information such as the server ID, user ID, time, etc that may also be used.

All multi-step message interactions use this format. So if you're looking to implement new behavior for the review flow or a completely new one, make sure to keep this in mind!
