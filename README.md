# ZISS
ZISS - **Z**ISS **i**s **s**o **s**illy  
* Made with [NodeJS](https://nodejs.org/)
* Single file
* Very smowl (600 lines)
* Somewhat fast (citation needed)
## Download
You can find the file [here](https://gist.github.com/SollyBunny/3107e20f5c4c45532e37cc800aa984a1/)
## Usage
This guide is for [Arch Linux](https://archlinux.org/) but will be similar for other distros/OSs
1. Install NodeJS & NPM  
	```sh
	sudo pacman -S node npm
	```
1. Install websocket (optional)  
	```sh
	npm i ws
	```
1. Download `webserver.js`  
	```sh
	wget https://gist.githubusercontent.com/SollyBunny/3107e20f5c4c45532e37cc800aa984a1/raw/c4d4cd419bc8fd5f10eff6ae7f340057ec79f2ea/webserver.js
	```  
	or  
	```sh
	curl -o webserver.js https://gist.githubusercontent.com/SollyBunny/3107e20f5c4c45532e37cc800aa984a1/raw/c4d4cd419bc8fd5f10eff6ae7f340057ec79f2ea/webserver.js
	```
1. Run it!  
	```sh
	chmod +x webserver.js
	./webserver.js
	```  
	or  
	```sh
	shnode ./webserver.js
	```
For further/advanced details see the mantext at the start of `webserver.js`
