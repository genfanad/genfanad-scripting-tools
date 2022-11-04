var express = require('express');
var path = require('path');
var fs = require('fs-extra');
var http = require('http');
var bodyParser = require('body-parser')
var DIR = require('./libraries/directory.js');

const PORT = 7782;
const CONTENT_DIRECTORY = './scripts/';

var app = express();
app.set('port', PORT);
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, GET");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
}); 
app.use(bodyParser.json({ limit: '50mb', extended: true }))

app.use(express.static(path.join(__dirname, '../client')));

app.get('/', function(req, res){ res.sendFile(path.join(__dirname, '../client/scripts.html')); });

let r = express.Router();
r.post('/scripts/download', (req, res) => {
  let data = fs.readFileSync(CONTENT_DIRECTORY + req.body.file);
  res.send(data);
})
r.post('/scripts/save', (req, res) => {
  let filename = req.body.filename;
  let body = req.body.file;

  fs.ensureFileSync(CONTENT_DIRECTORY + filename);
  fs.writeFileSync(CONTENT_DIRECTORY + filename, body);
});
r.get('/scripts', (req, res) => {
  let results = {};

  DIR.traverseDirectoryRaw(CONTENT_DIRECTORY, (k, v, meta) => {
      let c = results;
      for (let p of meta.pathlist) {
          if (!c[p]) c[p] = {};
          c = c[p];
      }

      let file = meta.short + meta.extension;
      c[file] = 'file';
  })

  res.send(JSON.stringify(results));
});
r.get('/items', (req, res) => {
  res.send(fs.readFileSync('./validation/items.json'));
});

app.use('/api', r);

var server = http.Server(app);
server.listen(PORT, function() {
    console.log('Starting server on port ' + PORT);
});