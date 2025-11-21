# <PROJECT_NAME>

<PROJECT_DESCRIPTION>

## CONFIGURATION

### Environment Variables (.env)

```dotenv
NODE_ENV="development"
APP_NAME="<PROJECT_NAME>"
ACTIVE_SPACE="spaces/kinetic"
PUBLIC_LOCATION="public"
PAGES_LOCATION="pages"
MINIFY=true
DEBUG=true
```

- APP_NAME — Your project’s application name.
- ACTIVE_SPACE — Path to the working “space” or directory where app files are "sourced" from.
- PUBLIC_LOCATION — Directory under ACTIVE_SPACE that acts as the public root for static assets.
- PAGES_LOCATION — Subdirectory under ACTIVE_SPACE containing HTML pages that map to routes.
- MINIFY — If true, CSS and JS assets will be minified during build or serve.
- DEBUG — If true, debug output will be printed to the console.

### Config File

Edit /config/default.json if changing the port and/or version number.
At minimum, it should contain:

```json
{
  "version": "1.0.0",
  "localPort": 3000
}
```

### Make this file your own!

Replace: <PROJECT_NAME> <PROJECT_DESCRIPTION>

### Make /package.json file your own!

Replace: name, version, description, author 

### Make /CHANGELOG.md file your own!

Replace: <APP_NAME> <yyyy_mm_dd> and maintain the file as your project grows.

## INSTALLATION

### Install packages

Node.js is required

```sh
$ node -v
$ npm install
```

## Start App (Server)

```sh
$ npm start
```

### Browser address: http://localhost:3000
### To change port, see /config for "localPort": 3000

## CUSTOMIZATION / STRUCTURE

```
index.js
/web-app
 |
 -- main.js
    web-app.js
/builders
 |
 --
```  

### Altair (module)

See the [README](./altair/README.md).

## License

[MIT](LICENSE)

## Astronomy

**Altair in the night sky**, designated as Alpha Aquilae, is a prominent star located in the constellation Aquila, known as the Eagle. It is the brightest star in this constellation and ranks as the twelfth brightest star in the night sky, with an apparent magnitude of 0.76. Altair is approximately 16.7 light-years from Earth.