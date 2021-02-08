import express from "express";
const app = express();
import doOpen from "open";

import fs from "fs";
import path from "path";

const argv = require("minimist")(process.argv.slice(2));

if (argv.h || argv.help) {
  console.log("LiaScript-LiveServer");
  console.log("");
  console.log("-h", "--help", "      show this help");
  console.log("-i", "--input", "     input ReadMe.md file");
  console.log("-p", "--port", "      used port number (default: 3000)");
  console.log("-l", "--live", "      do live reload on file change");
  console.log("-o", "--open", "      open in browser");

  process.exit();
}

const port = argv.p || argv.port || 3000;
const openInBrowser = argv.o || argv.open;
const input = argv.i || argv.input || ".";
const liveReload = argv.l || argv.live;

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

app.get("/liascript/index.html", function (req, res) {
  if (liveReload) {
    fs.readFile(
      __dirname + "/liascript/index.html",
      "utf8",
      function (err, data) {
        res.send(
          data.replace(
            "</head>",
            "<script type='text/javascript' src='/reloader/reloader.browser.js'></script></head>"
          )
        );
      }
    );
  } else {
    res.sendFile(req.path, { root: __dirname });
  }
});

// load everything from the liascript folder
app.get("/liascript/*", function (req, res) {
  res.sendFile(req.path, { root: __dirname });
});
// ignore this one
app.get("/sw.js", function (req, res) {});

// pass the reloader, to be used for live updates
app.get("/reloader/*", function (req, res) {
  res.sendFile(req.path, { root: __dirname });
});

// everything else comes from the current project folder
app.get("/*", function (req, res) {
  res.sendFile(req.originalUrl, { root: project.path });
});

let localURL = "http://localhost:" + port;

if (project.path && project.readme) {
  localURL +=
    "/liascript/index.html?http://localhost:" + port + "/" + project.readme;
}

console.log(`starting LiaScript server on port "${localURL}"`);

if (liveReload) {
  console.log(`Watching for changes in folder: "${project.path}"`);
  const reload = require("reloadsh.js")(app, [project.path]);

  reload.listen(port, () => {
    console.log("Server listen on", port);
  });
} else {
  app.listen(port);
}

if (openInBrowser) {
  doOpen(localURL);
}

// async function print(path: string) {
//   const dir = await fs.promises.opendir(path);
//   for await (const dirent of dir) {
//     console.log(dirent.name);
//   }
// }
// print("./").catch(console.error);
