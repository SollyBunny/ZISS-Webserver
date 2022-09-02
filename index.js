#!/usr/bin/env node
/*
Made by SollyBunny#6656 https://github.com/SollyBunny/webserver
Use ./index.js -p if nodejs complains about priv

If favicon.ico   is available it will be used as the favicon.
If homepage.html is available it will be used as the homepage.
The config file (default "config.json") is in json
	FILESDIR  : Where files are stored
	KEYDIR    : Where the Key  file is stored (SECURE only)
	CERTDIR   : Where the Cert file is stored (SECURE only)
	PORT      : Which port to use (defaults to 443 for SECURE, otherwise 80)
	SECURE    : Wether to use SECURE or not (true/false)
	GROUPS    : A list of names of groups
	SCRIPTS   : A list of handling scripts (place these scripts in filesdir)
	USERS     : A dictionary of users (<user>: [<password>, ...<groups>])
	WS        : Enable ws server (requires ws package) (true/false)
	WSSCRIPTS : Similar to SCRIPTS, required for WS
	IPBLACKLS : List of string IPs to block
HTTP scripts can be placed in any folder like a file and must contain a function like:
	module.exports = (ip, query, cookie) => {
		return [
			"text/plain",  // mime type
			"Hello World!" // data
		];
	};
WS scripts are similar to HTTP ones but require 3 functions allowing continious messages
	module.exports.join = (ws) => { // optional
		// Handle join	
	};
	module.exports.msg = (ws, msg) => {
		// Handle message (msg will be automaticly decoded from json)
	};
	module.exports.close = (ws) => { // optional
		// Handle close
	}
Example CONFIG
	{
		...
		"GROUPS"    : ["private", "personal", "solly", "linky"],
		"SCRIPTS"   : ["coolscript.js"]
		"REDIRECTS" : ["coolsite.url"]
		"USERS"     : {
			"admin" : ["password", "*"],
			"solly" : ["password", "private", "solly"],
			"linky" : ["password", "private", "linky"]
		},
		WS          : true,
		WSSCRIPTS   : ["game.js"]
		...
	}
*/
"use strict";

for (let i = 2; i < process.argv.length; ++i) { // parse cmdline args
	switch (process.argv[i].toLowerCase()) {
		case "-h":
		case "--help":
			console.log(`Usage: ${__filename.slice(__filename.lastIndexOf("/") + 1)} [CONFIGDIR] -h/--help -p/--priv`);
			process.exit(0);
		case "-p":
		case "--priv":
			require("child_process").execSync("sudo `which setcap` 'cap_net_bind_service=+ep' `which node`");
			process.exit(0);
	}
}

const CONFIGDIR   = process.argv[2] || "config.json";
const DEFAULTCONF = {
	"NAME"      : "NODEJS webserver",
	"FILESDIR"  : "files",
	"PORT"      : 80,
	"GROUPS"    : [],
	"USERS"     : {
		"admin" : ["password", "*"]
	}
}
const DEFAULTCONFSTR = `{
	"NAME"      : "NODEJS webserver",
	"FILESDIR"  : "files",
	"PORT"      : 80,
	"GROUPS"    : [],
	"USERS"     : {
		"admin" : ["password", "*"]
	}
}`;

global.INFO = 36; // Green
global.WARN = 33; // Yellow
global.FAIL = 31; // Red
global.FATL = 30; // Black
global.MISC = 35; // Magenta
global.log = (type, msg) => {
	let name;
	switch (type) {
		case INFO: name = "INFO"; break;
		case WARN: name = "WARN"; break;
		case FAIL: name = "FAIL"; break;
		case FATL: name = "FATL"; break;
		case MISC: name = "MISC"; break;
		default  : name = "UNKN";
	}
	console.log(`${Date.now()} \u001b[${type}m[${name}]\u001b[0m ${msg}`);
	if (type === FATL) process.exit(1);
};

if (__dirname !== process.cwd()) {
	log(WARN, `You are not running "${__filename}" in the same directory, changing directory automatically`);
	process.chdir(__dirname);
}

global.fs  = require("fs" );
global.url = require("url");
url.parseCookie = (cookie) => {
	if (!cookie) return {};
	let tempcookie = cookie.split(";");
	cookie = {};
	let m;
	for (let i = 0; i < tempcookie.length; ++i) {
		if ((m = tempcookie[i].indexOf("=")) === -1) continue;
		cookie[tempcookie[i].slice(0, m).trimLeft(" ")] = tempcookie[i].slice(m + 1);
	}
	return cookie;
};
if (global.fetch === undefined) {
	try {
		global.fetch = require("node-fetch");
	} catch {
		global.fetch = () => { log(WARN, "Fetch unavailable"); };
	}
}

let HTTPserver, WSserver, WSconnections;
let HTTPindex   = undefined;
let HTTPfavicon = undefined;
let conf;

// Load CONFIGDIR into conf
	function loadconf() {
		// Check CONFIGDIR is valid
			if (fs.existsSync(CONFIGDIR)) {
				if (fs.statSync(CONFIGDIR).isDirectory()) {
					log(WARN `Config file "${CONFIGDIR}" is a directory`);
					conf = DEFAULTCONF;
				} else {
					conf = fs.readFileSync(CONFIGDIR);
					try {
						conf = JSON.parse(conf);
					} catch (e) { if (e.name === "SyntaxError") {
						return `Failure parsing config file "${CONFIGDIR}" with error "${e.message}"`
					}}
				}
			} else {
				log(INFO, `Welcome to ${DEFAULTCONF.NAME}, make sure to read "${__filename.slice(__filename.lastIndexOf("/") + 1)}"`);
				fs.writeFile(CONFIGDIR, DEFAULTCONFSTR, (e) => { if (e)
					log(FATL, `Failed to write new config file ${CONFIGDIR}`);
				});
				conf = DEFAULTCONF;
				return true;
			}
		// Check conf.NAME is valid
			if (conf.NAME === undefined) conf.NAME = DEFAULTCONF.NAME;
		// Check conf.SCRIPTSis valid
			if (conf.SCRIPTS === undefined) {
				conf.SCRIPTS = DEFAULTCONF.SCRIPTS;
			} else if (Object.prototype.toString.call(conf.SCRIPTS) !== "[object Array]") {
				log(WARN, `Malformed "SCRIPTS" in "${CONFIGDIR}" (list)`);
				conf.SCRIPTS = DEFAULTCONF.SCRIPTS;
			} else {
				conf.SCRIPTS.forEach((i) => {
					if (i.slice(-3) !== ".js") 
						log(WARN, `Script "${i}" does not end in ".js"`);
				});
			}
		// Check conf.WSSCRIPTS is valid
			if (conf.WS) {
				if (conf.WSSCRIPTS === undefined) {
					log(WARN, `Define "WSSCRIPTS" in "${CONFIGDIR}"`);
					conf.WS = false;
				} else if (Object.prototype.toString.call(conf.WSSCRIPTS) !== "[object Array]") {
					log(WARN, `Malformed "WSSCRIPTS" in "${CONFIGDIR}" (list)`);
					conf.WS = false;
				} else if (conf.WSSCRIPTS.length === 0) {
					log(WARN, `Malformed "WSSCRIPTS" in "${CONFIGDIR}" (empty)`);
					conf.WS = false;
				} else {
					conf.WSSCRIPTS.forEach((i) => {
						if (typeof(i) !== "string") {
							log(WARN, `WS Script "${i}" is not a string`);
						} else if (i.slice(-3) !== ".js") {
							log(WARN, `WS Script "${i}" does not end in ".js"`);
						}
					});
				}
			}
		// Check conf.REDIRECTS is valid
			if (conf.REDIRECTS === undefined) {
				conf.REDIRECTS = [];
			} else if (Object.prototype.toString.call(conf.REDIRECTS) !== "[object Array]") {
				log(WARN, `Malformed "REDIRECTS" in "${CONFIGDIR}" (list)`);
				conf.REDIRECTS = [];
			} else {
				conf.REDIRECTS.forEach((i) => {
					if (typeof(i) !== "string") {
						log(WARN, `Redirect "${i}" is not a string`);
					} else if (i.slice(-4) !== ".url") {
						log(WARN, `Redirect "${i}" does not end in ".url"`);
					}
				});
			}
		// Check conf.GROUPS is valid
			if (conf.GROUPS === undefined) {
				log(WARN, `Define "GROUPS" in "${CONFIGDIR}"`);
				conf.GROUPS = DEFAULTCONF.GROUPS;
			} else if (Object.prototype.toString.call(conf.GROUPS) !== "[object Array]") {
				log(WARN, `Malformed "GROUPS" in "${CONFIGDIR}" (list)`);
				conf.GROUPS = DEFAULTCONF.GROUPS;
			} else {
				conf.GROUPS = conf.GROUPS.map((i) => { return i.toLowerCase(); });
			}
		// Check conf.USERS is valid
			if (conf.USERS === undefined) {
				log(WARN, `Define "USERS" in "${CONFIGDIR}"`);
				conf.USERS = {};
			} else if (Object.prototype.toString.call(conf.USERS) !== "[object Object]") {
				log(WARN, `Malformed "USERS" in "${CONFIGDIR}" (dictionary)`);
				conf.USERS = {};
			} else {
				Object.keys(conf.USERS).forEach((i) => {
					if (Object.prototype.toString.call(conf.USERS[i]) !== "[object Array]") {
						log(WARN, `Malformed "USERS" in "${CONFIGDIR}" (incorrect type)`);
						delete conf.USERS[i];
					} else if (conf.USERS[i].length === 0) {
						log(WARN, `Malformed "USERS" in "${CONFIGDIR}" (password missing)`);
						delete conf.USERS[i];
					} else {
						conf.USERS[i] = conf.USERS[i].map((m, i) => {
							if (i === 0) return m;
							return m.toLowerCase();
						});
					}
				});
			}
		// Check conf.IPBLACKLS Is valid
			if (conf.IPBLACKLS === undefined) {
				conf.IPBLACKLS = [];
			} else {
				if (Object.prototype.toString.call(conf.USERS) !== "[object Object]") {
					log(WARN, `Malformed "BLACKLS" in "${CONFIGDIR}" (incorrect type)`);
					conf.BLACKLS = [];
				}
			}
		// Load favicon.ico and index.html
			fs.readFile("favicon.ico", (err, data) => {
				if (err) {
					HTTPfavicon = undefined;
				} else {
					HTTPfavicon = data;
				}
			});
			fs.readFile("index.html", (err, data) => {
				if (err) {
					HTTPindex = undefined;
				} else {
					HTTPindex = data;
				}
			})
		return true;
	}
	WSconnections = loadconf(); // use WSconnections as temp
	if (WSconnections !== true) log(FATL, WSconnections);

// Verify conf.FILESDIR structure
	let fileventignore;
	function findvalidname(file) {
		while (fs.existsSync(`${conf.FILESDIR}${file}`)) file = "bak." + file;
		return file;
	}
	function movetoall(file) {
		let temp = findvalidname(`all/${file}`);
		fs.rename(`${conf.FILESDIR}${file}`, `${conf.FILESDIR}${temp}`, (e) => {
			if (e) log(FAIL, `Failed to move "${temp}"`);
			else   ++fileventignore;
		});
	}
	function checkfilesdirstructure() {
		if (fs.existsSync(`${conf.FILESDIR}all`)) {
			if (fs.statSync(`${conf.FILESDIR}all`).isFile())
				log(FATL, `File directory "${conf.FILESDIR}all" is a file`);
		} else {
			log(INFO, `Created Group directory "${conf.FILESDIR}all" as it didn't exist`);
			fs.mkdirSync(`${conf.FILESDIR}all`);
			++fileventignore;
		}
		conf.GROUPS.forEach((i, m) => {
			if (fs.existsSync(`${conf.FILESDIR}${i}`)) {
				if (fs.statSync(`${conf.FILESDIR}${i}`).isFile()) {
					log(WARN, `File directory "${conf.FILESDIR}${i}" is a file, moving to "all"`);
					movetoall(i);
				} else return;
			}
			log(INFO, `Created Group directory "${conf.FILESDIR}${i}" as it didn't exist`);
			fs.mkdirSync(`${conf.FILESDIR}${i}`);
			++fileventignore;
		});
		fs.readdirSync(conf.FILESDIR).forEach((i) => {
			if (fs.statSync(`${conf.FILESDIR}${i}`).isFile()) {
				log(WARN, `Found stray file "${i}", moving to "all"`);
				movetoall(i);
			}
		});
	}

// Check conf.FILESDIR is valid
	if (conf.FILESDIR === undefined) {
		log(WARN, `Define "FILESDIR" in "${CONFIGDIR}"`);
		conf.FILESDIR = DEFAULTCONF.FILESDIR;
	}
	if (conf.FILESDIR[conf.FILESDIR.length - 1] !== "/") { // conf.FILESDIR must have "/" at the end
		conf.FILESDIR += "/";
	}
	if (fs.existsSync(conf.FILESDIR)) {
		if (fs.statSync(conf.FILESDIR).isFile()) {
			log(FATL, `File directory "${conf.FILESDIR}" is a file`);
			// TODO rename file and put it in all
		}
		checkfilesdirstructure();
	} else {
		fs.mkdirSync(conf.FILESDIR);
		fs.mkdirSync(`${conf.FILESDIR}all`);
		log(INFO, `Creating "${conf.FILESDIR}" as it didn't exist`);
	}

// Watch for changes in conf.FILESDIR
fileventignore = 0;
fs.watch(conf.FILESDIR, { persistent: false	}, (event, file) => {
	if (fileventignore > 0) {
		--fileventignore;
		return;
	}
	if (event === "rename") {
		log(INFO, `Rechecking structure of ${conf.FILESDIR}`);
		checkfilesdirstructure();
	}
} );

const INDEX = `<!DOCTYPE html>
<html>
	<head>
		<title> ${conf.NAME} </title>
		<style>

		</style>
	</head>
	<script>
		window.onload = () => {
			const ws = NEW WebSocket(".:${conf.PORT}");
			console.log(ws);
		};
	</script>
	<body>

	</body>
</html>`

// TODO cache output
function listdir(dir) {
	let files = fs.readdirSync(dir);
	let fdir = dir.slice(conf.FILESDIR.length); // Remove conf.FILESDIR from the beginning
	if (conf.WS) {
		files = files.filter((i) => {
			 return conf.WSSCRIPTS.indexOf(i) === -1
		});
	}
	if (files.length === 0) return `${fdir}:<br>There's nothing here!`;
 	return `${fdir}:<form style="float:right" action="untitled" method="post" enctype="multipart/form-data">
 	<button type="button"><label for="file">Upload</label></button>
	<input style="display: none" id="file" type="file" name="file" onchange="this.parentElement.action=(document.location.pathname==='/'?'/all':document.location.pathname)+'/'+this.value.slice(this.value.lastIndexOf('\\\\') + 1);this.parentElement.requestSubmit()">
</form> <br>` + ( // 
		files.map((i) => {
			if (fs.statSync(`${dir}/${i}`).isDirectory()) {
				return `📁&nbsp<a href="${fdir}/${i}">${i} (dir)</a>`;
			} else if (conf.SCRIPTS.indexOf(i)   !== -1) {
				return `📜&nbsp<a href="${fdir}/${i}">${i} (script)</a>`;
			} else if (conf.REDIRECTS.indexOf(i) !== -1) {
				return `🔗&nbsp<a href="${fdir}/${i}">${i} (redirect)</a>`;
			} else {
				return `📑&nbsp<a href="${fdir}/${i}">${i}</a>`;
			}
		}).join("<br>")
	); 
}

function HTTPhandle(req, res) {

	req.ip = req.connection.remoteAddress.replace(/^.*:/, "");
	if (conf.IPBLACKLS.indexOf(req.ip) !== -1) {
		log(INFO, `${req.ip} \u001b[31mURL\u001b[39m ${req.url}: Blocked by blocklist`);
		res.end("Blocked by blocklist");
		return;
	}
	log(INFO, `${req.ip} \u001b[31mURL\u001b[39m ${req.url} ${req.headers.cookie ? "\u001b[31mCookie\u001b[39m " + req.headers.cookie : ""}`);
	req.url    = url.parse(req.url, false);
	req.cookie = url.parseCookie(req.headers.cookie);

	// check credentials
		let groups;
		if (req.cookie.u && conf.USERS[req.cookie.u] && conf.USERS[req.cookie.u][0] === req.cookie.p) {
			groups = conf.USERS[req.cookie.u].slice(1);
			if (groups.indexOf("*") !== -1) groups = conf.GROUPS;
			groups.push("all");
		} else {
			groups = ["all"];
		}

	// handle file upload
		if (req.method === "POST") {
			res.writeHead(504)
			res.end("Sorry, this isn't supported yet");
			return;
			if (groups.indexOf(req.url.pathname.match(/(?<=\/)[^\/]*/)[0]) === -1) {
				res.writeHead(401);
				res.end();
				return;
			}
			req.setTimeout(60 * 10 * 1000); // 10 minutes
			let filename = findvalidname(`${conf.FILESDIR}${req.url.pathname}`);
			let stream = fs.createWriteStream(filename);
			req.pipe(stream);
			log(INFO, `Starting upload of "${filename}"`);
			let i = 0
			req.on("pipe", (d) => {
				log(INFO, `Recieved chunk ${i}`);
				++i;
			});
			req.on("error", (e) => {
				res.writeHead(500);
				res.end();
				console.log(e.stack);
				log(FAIL, `Upload of "${filename}" failed`);
			});
			stream.on("unpipe", (e) => {
				res.writeHead(200);
				res.end();
				e = fs.readFileSync(filename).toString();
				e = e.slice(
					e.indexOf("\n", e.indexOf("Content-Type")) + 3,
					e.lastIndexOf("\n", e.lastIndexOf("\n") - 1) - 1
				);
				fs.writeFileSync(filename, e)
				log(INFO, `Upload of "${filename}" succeeded`);
			});
			return;
		}
		
	switch (req.url.pathname) { // main handling

		case "/":
			if (HTTPindex) {
				res.writeHead(200, {
					"Content-Type": "text/html"
				});
				res.end(HTTPindex);
				break;
			}
		case "/files":
			let files = groups.map((i) => {
				return listdir(`${conf.FILESDIR}${i}`);
			}).join("<br><br>");
			res.writeHead(200, {
				"Content-Type": "text/html"
			});
			res.end(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>${conf.NAME}</title></head><body><h1>${conf.NAME}</h1>
	<h3>Login:</h3>
	<form onsubmit='document.cookie="u="+document.getElementById("u").value+"; SameSite=strict; max-age=31536000";document.cookie="p="+document.getElementById("p").value+"; SameSite=strict; max-age=31536000";document.location="/";return false;'>
		Name <input id="u" required type="text"><br>
		Pass <input id="p" required type="password"><br>
		<input type="submit" value="Login">
	</form> <button onclick="document.cookie='u=; SameSite=strict';document.cookie='p=; SameSite=strict';document.location.reload();">Logout</button>
	<h3>Files:</h3>
	${files}
	<a href="/source.js" target="_blank" rel="noopener noreferrer" style="position:fixed;right:5px;bottom:5px;font: 16px monospace;text-decoration: none;">📑</a>
	<a class="github-corner" href="https://github.com/SollyBunny/webserver" aria-label="View source on GitHub"><svg width="80" height="80" viewBox="0 0 250 250" style="fill:#151513; color:#fff; position: fixed; top: 0; border: 0; right: 0;" aria-hidden="true"><path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path><path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path><path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path></svg></a><style>.github-corner:hover .octo-arm{animation:octocat-wave 560ms ease-in-out}@keyframes octocat-wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-25deg)}40%,80%{transform:rotate(10deg)}}@media (max-width:500px){.github-corner:hover .octo-arm{animation:none}.github-corner .octo-arm{animation:octocat-wave 560ms ease-in-out}}</style>
</body></html>`);
			break;
		case "/favicon.ico":
			if (HTTPfavicon) {
				res.writeHead(200, {
					"Content-Type": "image/x-icon"
				});
				res.end(HTTPfavicon);				
			} else {
				res.writeHead(404);
				res.end();
			}
			break;
		case "/source.js":
			fs.readFile(__filename, (err, data) => {
				res.writeHead(200, {
					"Content-Type": "application/javascript"
				});
				res.end(data);
			});
			break;
		default: // read file
			if (groups.indexOf(req.url.pathname.match(/(?<=\/)[^\/]*/)[0]) === -1) {
				res.writeHead(401, {
					"Content-Type": "text/html"
				});
				res.end("Lacking permission<br><a href='/'>Back</a>");
				return;
			}
			req.url.pathname = `${conf.FILESDIR}${decodeURI(req.url.pathname)}`; // normalize pathname into filepath
			if (!fs.existsSync(req.url.pathname)) {
				res.writeHead(404, {
					"Content-Type": "text/html"
				});
				res.end("Cannot find file<br><a href='/'>Back</a>");
			} else if (fs.statSync(req.url.pathname).isDirectory()) { // directory
				res.writeHead(200, {
					"Content-Type": "text/html"
				});
				res.end(`<!DOCTYPE html><head><meta charset="UTF-8"></head>${listdir(req.url.pathname)}`);
			} else if (conf.WSSCRIPTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) !== -1) { // wsscript
				res.writeHead(200, {
					"Content-Type": "text/html"
				});
				res.end("Cannot read ws script<br><a href='/'>Back</a>");
			} else if (conf.REDIRECTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) !== -1) { // wsscript
				fs.readFile(req.url.pathname, (e, data) => {
					if (e) {
						res.writeHead(500, {
							"Content-Type": "text/html"
						});
						res.end(`Error ${e.message}<br><a href='/'>Back</a>`);
					} else {
						res.writeHead(307, {
							"Location": data.toString("utf-8").trimRight("\n") // Remove \n in most files
						});
						res.end();
					}
				});
			} else if (conf.SCRIPTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) !== -1) { // script
				// delete require.cache[require.resolve(`${conf.FILESDIR}${req.url.pathname}`)]; // debug script
				let func = require(req.url.pathname)(req.ip, req.url.query, req.cookie);
				func.then(data => {
					if (
						(data    === undefined) ||
						(data[1] === undefined)
					) data = ["text/html", "Broken script<br><a href='/'>Back</a>"];
					res.writeHead(200, {
						"Content-Type": data[0],
						"Access-Control-Allow-Origin": "*"
					});
					res.end(data[1]);
				});
			} else {
				// Create read stream
					try {
						data = fs.createReadStream(req.url.pathname);
					} catch (e) {
						res.writeHead(500);
						res.end();
						return;
					}
				// Serve
					res.writeHead(200, {
						"Content-Type": (req.url.pathname.slice(-3) === ".js" ? "text/javascript" : "text/html")
					}); 
					data.pipe(res);
			}
	};
};

function WShandle(req, socket, head) {

	req.ip     = req.connection.remoteAddress.replace(/^.*:/, "");
	if (conf.IPBLACKLS.indexOf(req.ip) !== -1) {
		log(INFO, `${req.ip} \u001b[31mWS\u001b[39m ${req.url}: Blocked by blocklist`);
		socket.destroy();
		return false;
	}
	log(INFO, `\u001b[31mWS\u001b[39m ${req.ip} \u001b[31mURL\u001b[39m ${req.url} ${req.headers.cookie ? "\u001b[31mCookie\u001b[39m " + req.headers.cookie : ""}`);
	req.url    = url.parse(req.url, false);
	req.cookie = url.parseCookie(req.headers.cookie);

	// check credentials
		let groups;
		if (req.cookie.u && conf.USERS[req.cookie.u] && conf.USERS[req.cookie.u][0] === req.cookie.p) {
			groups = conf.USERS[req.cookie.u].slice(1);
			if (groups.indexOf("*") !== -1) groups = conf.GROUPS;
			groups.push("all");
		} else {
			groups = ["all"];
		}

	// verify validity of script
		if (groups.indexOf(req.url.pathname.match(/(?<=\/)[^\/]*/)[0]) === -1) {
			socket.destroy();
			return false;
		}
		req.url.pathname = `${conf.FILESDIR}${decodeURI(req.url.pathname)}`; // normalize pathname into filepath
		if (
			(!fs.existsSync(req.url.pathname)) ||
			(conf.WSSCRIPTS.indexOf(req.url.pathname.slice(req.url.pathname.lastIndexOf("/") + 1)) === -1) ||
			(fs.statSync(req.url.pathname).isDirectory())
		) {
			socket.destroy();
			return false;
		}

		let script = require(req.url.pathname);
		if (script.join === undefined || script.msg === undefined || script.close === undefined) {
			log(WARN, `WS Script "${req.url.pathname}" is malformed (missing functions)`);
			socket.destroy();
			return false;	
		}

	// accept connection and start handelers
		WSserver.handleUpgrade(req, socket, head, (ws) => {
			ws.sendjson = (data) => {
				ws.send(JSON.stringify(data));
			};
			Object.defineProperty(ws, "url", { // Bypass property shenanigans
				value: req.url
			});
			ws.ip     = req.ip;
			ws.cookie = req.cookie;
			ws.groups = req.groups;
			if (script.join) script.join(ws);
			ws.handlemsg   = script.msg;
			if (script.close) ws.handleclose = script.close;
	    	WSserver.emit("connection", ws, req);
	    });
		
}

// HTTPserver setup
	if (conf.SECURE) {
		let flag = 0;
		if (!fs.existsSync(conf.KEYDIR )) {
			log(WARN, `Cert file "${conf.KEYDIR }" (KEYDIR) doesn't exist`);
			flag = 1;
		}
		if (!fs.existsSync(conf.CERTDIR)) {
			log(WARN, `Cert file "${conf.CERTDIR}" (CERTDIR) doesn't exist`);
			flag = 1;
		}
		if (flag === 1) {
			HTTPserver = require("http").createServer(HTTPhandle);
		} else {
			// HTTPserver = require("http2").createSecureServer({ // http2/ws doesn't work );
			HTTPserver = require("https").createServer({
				enableConnectProtocol: true,
				key : fs.readFileSync(conf.KEYDIR ),
				cert: fs.readFileSync(conf.CERTDIR),
			}, HTTPhandle);
		}
	} else {
		HTTPserver = require("http").createServer(HTTPhandle); 
	}
	if (conf.PORT === undefined) {
		if (conf.HTTPS) {
			conf.PORT = 443;
			log(WARN, `Define "PORT" in "${CONFIGDIR}" (Default: 443)`);
		} else {
			conf.PORT = 80;
			log(WARN, `Define "PORT" in "${CONFIGDIR}" (Default: 80)`);
		}
	}
	HTTPserver.on("error", (e) => {
		switch (e.code) {
			case "EADDRINUSE":
				log(FATL, `HTTP Server could not be started: already running on port ${conf.PORT}`);
			case "EACCES":
				log(FATL, `HTTP Server could not be started: try ./${__filename.slice(__filename.lastIndexOf("/") + 1)} --priv`);
			default: // unknown
				console.log(e.stack);
				log(FATL, "HTTP Server could not be started");
		}
	});
	HTTPserver.listen(conf.PORT, () => {
		log(INFO, `HTTP Server Started`);
	});

// WSserver setup
	if (conf.WS) {
		WSconnections = [];
		try {
			WSserver = new (require("ws").WebSocketServer)({
				noServer: true,
				autoAcceptConnections: false
			});
			log(INFO, `WS Server Started`);
			HTTPserver.on("upgrade", WShandle);
			WSserver.on("connection", (ws, req) => {
				WSconnections.push(ws);
				ws.on("message", (msg) => {
					try {
						msg = JSON.parse(msg);
					} catch (e) {
						msg = {};
					}
					ws.handlemsg(ws, msg);
				});
				ws.on("close", () => {
					WSconnections = WSconnections.filter((i) => { return i !== ws; });
					if (ws.handleclose) ws.handleclose(ws);
				});
			});
		} catch (e) {
			console.log(e);
			log(FATL, `Websocket Server could not be started, have you installed ws?`);
		}
	}

let triedexit = 0;
function exit() {
	if (triedexit === 1) log(FATL, `Server Force Shutting Down`);
	triedexit = 1;
	process.stdin.setRawMode(false);
	process.stdin.destroy();
	HTTPserver.close();
	if (conf.WS) {
		WSconnections.forEach((i) => {
			i.close();
		});
		WSserver.close();
	}
	log(INFO, `Server Shutting Down`);
}
process.on("SIGINT", exit);
process.on("uncaughtException", (e) => {
	log(FAIL, e.stack);
});

let data = "";
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (key) => {
	// console.log(key.charCodeAt());
	switch (key) {
		case "\u0003":
			exit();
			return;
		case "\u007f":
			process.stdin.write("\b \b");
			data = data.slice(0, -1);
			return;
		case "\r":
			break;
		case " ":
		case "\t":
			if (data.length === 0)
				return;
		default:
			data += key;
			process.stdin.write(key);
			return;
	}
	data = data.trim();
	if (data.length === 0) return;
	process.stdin.write("\n");
	switch (data) {
		case "":
			break;
		case "help":
			log(MISC, `help: Show this menu
exit: stop the server (if doesn't stop, type again to force)
config: print the config
reloadconfig: reload the config file
uptime: print uptime of server`);
			break;
		case "exit":
			exit();
			break;
		case "config":
			log(MISC, JSON.stringify(conf, true, 4));
			break;
		case "reloadconfig":
			data = loadconf();
			if (data === true) {
				log(MISC, `Reloaded config file ${CONFIGDIR}`)
			} else {
				log(MISC, temp);
			}
			checkfilesdirstructure();
			break;
		case "wslist":
			if (!conf.WS) {
				log(MISC, "WS server not enabled");
				break;
			}
			log(MISC, "Current connected WS:");
			WSconnections.forEach((i) => {
				console.log(i);
				console.log(`\u001b[31mIP\u001b[39m ${i.ip} \u001b[31mURL\u001b[39m ${i.url}`);
			})
			break;
		case "uptime":
			data = Math.floor(process.uptime());
			if (data > (60 * 60 * 60 * 24)) { // days
				data = `${Math.floor(data / (60 * 60 * 60))}d ${Math.floor(data / (60 * 60))}h ${Math.floor(data / 60)}m ${data % 60}s`;
			} else if (data > (60 * 60 * 60)) { // hours
				data = `${Math.floor(data / (60 * 60))}h ${Math.floor(data / 60)}m ${data % 60}s`;				
			} else {
				data = `${Math.floor(data / 60)}m ${data % 60}s`;
			}
			log(MISC, data);
			break;
		default:
			log(MISC, `Unknown command "${data}", try using "help"`);
	}
	data = "";
});
