# Extensible Bot Core
A collection of core utilities to build bots around

## What is this?
The **EBC** is the basis to whatever you wish it to be. In essence, it is a set of tools used for creating bots in Node. This includes for example a command parsing class, REPL-style command input input and a plugin loader that supports hot reloading of plugins.

## Components
- ### Plugin Loader
        Dynamically load, unload and manage plugins. Asynchronous and hot-swappable.

- ### Command Parser
        Manage and create difficult commands/subcommands with ease, automatically create help messages and handle permissions.

- ### CLI
        A REPL style CLI to manage the bot at runtime

## Contributing
The core is written in TypeScript, a typed superset to Javascript and executed with NodeJS. Pull Requests welcome.

Before cloning this repository, make sure you have [Node](https://www.nodejs.org/) installed.

Then clone this repository, open a terminal/command prompt and type `npm i` to install the required dependencies.

`ts-node` is recommended to test during development, install it with `npm i -g ts-node typescript`.

## Scripts
Execute the scripts with `npm run <script>`
- `test` - Checks for remaining `TODO:` in the source files and warns the user
- `lint` - Runs `eslint` and checks for code styling problems
- `build` - Compile the TypeScript Source to `dist/`
- `start` - Run `test` and `build`, then try and execute the `main.js` in the root which serves as entrypoint and exposes the Components
