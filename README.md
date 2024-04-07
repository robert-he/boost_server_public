# project boost server

This project was built using JavaScript, React, Express.js, Node, React-Router, Redux, Mongodb


Boost is an prescriptive app that helps maximize productivity by gathering data on where + when users are productive and returns recommendations based on the inputted data.

This is the project server, build with node (+ babel) and express.js, using airbnb eslint rules. Procfile is set up to run on [heroku](https://devcenter.heroku.com/articles/getting-started-with-nodejs#deploy-the-app).

## Architecture

```
├──[project-boost-server]/       # root directory
|  └──[src]/                     # source of MVC framework
|     └──[controllers]/          # db controllers
|     └──[models]/               # db models
|     └──[services]/             # external services + api integration
|     └──[router.js]             # project router
|     └──[server.js]             # project server
```

## Setup

### Tools:
- You will need [Node.js](https://nodejs.org/en/), [yarn](https://yarnpkg.com/en/), [mongo/mongoDB](https://www.mongodb.com/), and [heroku](https://www.heroku.com) installed locally in order to build, run and develop this project.

- Tool installation instructions (for mac, using homebrew)
	- `brew install node` (you will need version >=9.x and <= 10.x)
		- Note: for advanced usage, we also recommend installing Node.js via a version manager such as [nvm](https://github.com/creationix/nvm) instead of with homebrew. To do so, run `curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.34.0/install.sh | bash`. Be sure to set your `.bash_profile` file by following the instructions listed in the [nvm repository](https://github.com/creationix/nvm).
	- `brew install yarn`
	- `brew install mongo`
	- `brew install heroku/brew/heroku`

### Installation

- `git clone https://github.com/dartmouth-cs52-19S/project-boost-server`
- `cd project-boost-server/`
- `yarn`
- start a local server with `yarn start`
- build with `yarn build`

## Deployment

To deploy to heroku, first create a heroku project and account, then add a remote. See [heroku](http://heroku.com) for details.

Once this is complete, run:
- `yarn build`
- `git push heroku master`

## Authors

Thomas Monfre '21,
Robert He '19,
Faustino Cortina '21,
Varsha Iyer '21,
Syed Tanveer, '21

## Acknowledgments
We would like to thank Tim for being a great prof and providing a wealth of knowledge, and Sofia for being an amazing resource for help and support. Also thank you to stack overflow, and just generally google.
