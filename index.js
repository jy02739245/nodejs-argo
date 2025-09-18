const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

// -------------------- 环境变量 --------------------
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const FILE_PATH = process.env.FILE_PATH || './tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'www.visa.com.sg';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || 'Vls';

// 新增 Komari 支持
const KOMARI_SERVER = process.env.KOMARI_SERVER || '';
const KOMARI_KEY = process.env.KOMARI_KEY || '';

// -------------------- 初始化目录 --------------------
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

let npmPath = path.join(FILE_PATH, 'npm');
let phpPath = path.join(FILE_PATH, 'php');
let webPath = path.join(FILE_PATH, 'web');
let botPath = path.join(FILE_PATH, 'bot');
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

// -------------------- 根路由 --------------------
app.get("/", function(req, res) {
  res.send("Hello world!");
});

// -------------------- 下载并运行依赖 --------------------
async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, fileName) => {
        if (err) reject(err); else resolve(fileName);
      });
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) {
    console.error('Error downloading files:', err);
    return;
  }

  // 授权
  const filesToAuthorize = NEZHA_PORT ? ['./npm', './web', './bot'] : ['./php', './web', './bot'];
  authorizeFiles(filesToAuthorize);

  // 运行哪吒探针
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsPorts = new Set(['443','8443','2096','2087','2083','2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      const configYaml = `
client_secret: ${NEZHA_KEY}
server: ${NEZHA_SERVER}
tls: ${nezhatls}
uuid: ${UUID}`;
      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
      const command = `nohup ${FILE_PATH}/php -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`;
      try { await exec(command); console.log('php is running'); } catch(e) { console.error(e); }
    } else {
      let NEZHA_TLS = '';
      if (["443","8443","2096","2087","2083","2053"].includes(NEZHA_PORT)) NEZHA_TLS = '--tls';
      const command = `nohup ${FILE_PATH}/npm -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${NEZHA_TLS} >/dev/null 2>&1 &`;
      try { await exec(command); console.log('npm is running'); } catch(e) { console.error(e); }
    }
  } else {
    console.log('NEZHA variable is empty, skip running');
  }

  // 运行 Komari agent
  if (KOMARI_SERVER && KOMARI_KEY) {
    const komariCmd = `bash <(curl -sL https://raw.githubusercontent.com/komari-monitor/komari-agent/refs/heads/main/install.sh) -e ${KOMARI_SERVER} -t ${KOMARI_KEY}`;
    try {
      await exec(`nohup ${komariCmd} >/dev/null 2>&1 &`);
      console.log('Komari agent is running');
    } catch (error) {
      console.error(`Komari agent running error: ${error}`);
    }
  } else {
    console.log('KOMARI variable is empty, skip running');
  }

  // 运行 web (xray)
  const command1 = `nohup ${FILE_PATH}/web -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
  try { await exec(command1); console.log('web is running'); } catch(e) { console.error(e); }

  // 运行 cloudflared
  if (fs.existsSync(path.join(FILE_PATH, 'bot'))) {
    let args;
    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH.match(/TunnelSecret/)) {
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    }
    try { await exec(`nohup ${FILE_PATH}/bot ${args} >/dev/null 2>&1 &`); console.log('bot is running'); } catch(e) { console.error(e); }
  }
}

// -------------------- 工具函数 --------------------
function getSystemArchitecture() { return ['arm','arm64','aarch64'].includes(os.arch()) ? 'arm' : 'amd'; }
function authorizeFiles(filePaths) { filePaths.forEach(f => { const abs = path.join(FILE_PATH, f); if (fs.existsSync(abs)) fs.chmod(abs, 0o775,()=>{}); }); }
function downloadFile(fileName, fileUrl, cb) { const f = path.join(FILE_PATH, fileName); const writer = fs.createWriteStream(f); axios({method:'get',url:fileUrl,responseType:'stream'}).then(r=>{r.data.pipe(writer);writer.on('finish',()=>{writer.close();cb(null,fileName)});writer.on('error',err=>{fs.unlink(f,()=>{});cb(err.message)});}).catch(e=>cb(e.message)); }
function getFilesForArchitecture(arch) { if (arch==='arm') { return [ {fileName:"web",fileUrl:"https://arm64.ssss.nyc.mn/web"}, {fileName:"bot",fileUrl:"https://arm64.ssss.nyc.mn/2go"} ]; } else { return [ {fileName:"web",fileUrl:"https://amd64.ssss.nyc.mn/web"}, {fileName:"bot",fileUrl:"https://amd64.ssss.nyc.mn/2go"} ]; } }

// -------------------- 启动 --------------------
async function startserver() {
  await downloadFilesAndRun();
}
startserver();

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));
