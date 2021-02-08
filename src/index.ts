import express from "express";
const app = express();
import doOpen from "open";

import fs from "fs";
import path from "path";

const argv = require("minimist")(process.argv.slice(2));

console.log(argv.open);

if (argv.h || argv.help) {
  console.log("LiaScript-LiveServer");
  console.log("");
  console.log("-h", "--help", "      show this help");
  console.log("-i", "--input", "     input ReadMe.md file");
  console.log("-p", "--port", "      used port number (default: 3000)");
  console.log("-o", "--open", "      open in browser");

  process.exit();
}

const port = argv.p || argv.port || 3000;
const openInBrowser = argv.open;
const input = argv.i || argv.input;

var project = {
  path: null,
  readme: null,
};

if (input) {
  const stats = fs.lstatSync(input);

  // Is it a directory?
  if (stats.isDirectory()) {
    project.path = input;
  } else if (stats.isFile()) {
    project.path = path.dirname(input);
    project.readme = path.basename(input);
  }
}

app.get("/", function (req, res) {
  res.sendFile("./assets/index.html", { root: __dirname });
});

app.get("/liascript/", function (req, res) {
  res.redirect("/liascript/index.html");
});

app.get("/liascript/*", function (req, res) {
  res.sendFile(req.path, { root: __dirname });
});

app.get("/*", function (req, res) {
  res.sendFile(req.originalUrl, { root: project.path });
});

console.log("starting live server on port", port);

app.listen(port);

if (openInBrowser) {
  if (typeof project.readme === "string") {
    doOpen(
      "http://localhost:" +
        port +
        "/liascript/index.html?http://localhost:" +
        port +
        "/" +
        project.readme
    );
  }
}

// async function print(path: string) {
//   const dir = await fs.promises.opendir(path);
//   for await (const dirent of dir) {
//     console.log(dirent.name);
//   }
// }
// print("./").catch(console.error);
