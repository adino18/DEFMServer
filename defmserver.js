#!/usr/bin/env node
const px2mm = 3.54328571429;
var Infinity = 1e90;
var MAXCOOR = {X:170, Y:280};
//require
var express = require('express'),
    app = express(),
    server = require('http').createServer(app),
    io = require('socket.io').listen(server),
    fs = require('fs'),
	siofu = require("socketio-file-upload"),
	argv = require('optimist').argv,
	phpjs = require('phpjs'),
    Jimp = require('jimp'),
	Vec2 = require('vec2'),
	sizeOf = require('image-size'),
    Deque = require("double-ended-queue"),
    svg2gcode = require('./lib/svg2gcode'),
	pic2gcode = require('./lib/pic2gcode'),
	exec 		=	require('child_process').exec,
	potrace = require('potrace');
//argv
	argv.machinehost	=	argv.machinehost || 'http://192.168.1.6:81';
	argv.serverPort		=	argv.serverPort		|| 9090;						//DEFM Server nodejs port
	argv.minDistance	=	argv.minDistance	|| 50;							//queue will set to empty if the distance from now laser position to goal position is less than 6em					
	argv.maxDistance	=	argv.maxDistance	|| 100;							//queue is full if the distance they went enough 8mm or more one comand
	argv.minQueue		=	argv.minQueue		|| 10;							//queue has at least 5 elements
	argv.maxQueue		=	argv.maxQueue		|| 30;							//queue has at maximum 20 elements
	argv.maxLengthCmd	=	argv.maxLengthCmd	|| 127;							//maxLength of batch process, in grbl wiki, it is 127
	// argv.minCPUTemp		=	argv.minCPUTemp		|| 70;						// if galileo temp <= this => turn the fan off
	// argv.maxCPUTemp		=	argv.maxCPUTemp		|| 80;						// if galileo temp > this => turn the fan on
	argv.maxCoorX		=	argv.maxCoorX		|| MAXCOOR.X;							// your max X coordinate 
	argv.maxCoorY		=	argv.maxCoorY		|| MAXCOOR.Y;							// your max Y coordinate
	argv.intervalTime1	=	argv.intervalTime1	|| 10000;						//10s = 10000ms. Each 10s, we check grbl status once
	argv.intervalTime3	= 	argv.intervalTime3	|| 610;						    //check current laser after 610ms
	argv.intervalTime4	=	argv.intervalTime4	|| 30000;						//30s = 30000ms. Each 30s, we check server load once
	argv.intervalTime5	=	argv.intervalTime5	|| 60;							//60s. Each 1 minute, we check grbl status to change to power saving mode
	// argv.intervalTime6	=	argv.intervalTime6	|| 10000;						//10s. Each 10 seconds, we update Server log/ Galileo temperature OR Laser position once.
	argv.maxFileSize 	= 	argv.maxFileSize	|| 1.5 * 1024 * 1024;			//unit: byte
	argv.privateApiKey 	= 	argv.privateApiKey 	|| 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhMWM0OTczYy02MTVhLTQ3YzMtYTQ1YS03YTEwMGY2YjliNDIifQ.7QLU4z0_lzAQhcF8QKmKyvb7TCx11Es9gDZ4bA0Yo2s';		//privateApiKey (Ionic App), create your own or use my own
	argv.ionicAppId		=	argv.ionicAppId 	|| '3e97516a';												//ionic app id (ionic app), create your own or use my own
	// argv.LCDcontroller 	= 	argv.LCDcontroller 	|| "PCF8574";												//default I2C Controller
	argv.feedRate		=	(argv.feedRate != undefined) ? argv.feedRate : 100;								//-1 means fetch from sdcard
	argv.maxLaserPower	= 	argv.maxLaserPower	|| 100;
	argv.resolution		=	argv.resolution		|| px2mm;		//picture 2 gcode resolution
	argv.scale			= 	argv.scale			|| 100;			//scale picture by percent

//var
var	gcodeQueue	= 	new Deque([]),
	gcodeDataQueue= new Deque([]),
	tokenDevice	=	[],
	rememberTokenDevice = [],
	SVGcontent	=	"",
	currentQueue=	0,
	currentDistance=0,
	minDistance	=	phpjs.intval(argv.minDistance),		
	maxDistance	=	phpjs.intval(argv.maxDistance),							
	minQueue	=	phpjs.intval(argv.minQueue),							
	maxQueue    =	phpjs.intval(argv.maxQueue),							
	timer1		=	phpjs.time(),
	timer2		=	phpjs.time(),
	timer2		=	0,
	timer3		=	phpjs.time(),
	socketClientCount	= 0,
	copiesDrawing = 1,
	// lcdBusy 	= false,
	//galileo pinout
	// fanPin				=	7,
	// greenButtonPin		=	8,
	// redButtonPin		=	9,
	minCPUTemp	=	phpjs.intval(argv.minCPUTemp),
	maxCPUTemp	=	phpjs.intval(argv.maxCPUTemp),
	machineRunning		=	false,
	machinePause		=	true,
	canSendImage		=	false,
	imagePath			=	'',
	laserPos	=	new Vec2(0, 0),
	goalPos		=	new Vec2(0, 0),
	intervalTime1		=	phpjs.intval(argv.intervalTime1),
	intervalTime2		=	phpjs.intval(argv.intervalTime2),
	intervalTime3		= 	phpjs.intval(argv.intervalTime3),
	intervalTime4		=	phpjs.intval(argv.intervalTime4),
	intervalTime5		=	phpjs.intval(argv.intervalTime5),
	intervalTime6		=	phpjs.intval(argv.intervalTime6),
	//implement	
	lcd,
	ipAddress,
	newConnection ='',								
	sendLCDMessage,
	serverLoad,
	tempGalileo,
	fan,
	relay,
	greenButton,
	redButton;

var __serial_free	= true;
var __sent_count	= 0; 
var __sent_count_direct = 0;
var __serial_queue	= [];
var __preProcessQueue = {command: ""};
var _getIpAddress_idx = 0;
var W3CWebSocket = require('websocket').w3cwebsocket;

var ws = new W3CWebSocket('ws://'+argv.machinehost);

// function getIpAddress() {
// 	var ip = sh.exec("ifconfig | grep -v 169.254.255.255 | grep -v 127.0.0.1 |  awk '/inet addr/{print substr($2,6)}'").stdout;	
// 	ip = phpjs.explode("\n", ip);
// 	console.log(ip);
// 	var count = phpjs.count(ip) - 1;
// 	if (count == 0)
// 		return "";
// 	_getIpAddress_idx = (_getIpAddress_idx + 1) % count;
// 	return ip[_getIpAddress_idx];
// }	
var file;
var filepath;
var options;
var isPICfile;
var content;
var isConvert = false;
var toSVGContent = '';
app.use('/upload', express.static(__dirname + '/upload'));

io.sockets.on('connection', function (socket) {
	socketClientCount++;
	//socket ip
	
    if(newConnection == ''){
            var newConnection = socket.request.connection.remoteAddress;
            console.log('New connection from ' + newConnection);
    }
    if(newConnection != socket.request.connection.remoteAddress)
     console.log('New connection from ' + socket.request.connection.remoteAddress);
	
	var uploader = new siofu();
    uploader.dir = "./upload";
    uploader.listen(socket);
	
	uploader.on("start", function(event) {
		console.log("uploading....");
		console.log(argv.maxCoorX+","+argv.maxCoorY);
		pic2gcode.clear();
		if(filepath) fs.unlink(filepath);
		isConvert = false;
		event.file.name = phpjs.str_replace("'", "", event.file.name);
		var file = event.file;
		var fileSize = file.size;
		if (fileSize > argv.maxFileSize) {
			socket.emit("error", {id: 3, message: "MAX FILE FILE is " + (settings.maxFileSize / 1024 / 1024) + "MB"});
			return false;
		}
	});
    
	 // Do something when a file is saved:
	var __upload_complete = function(file, content, filepath) {
		addQueue(content);
		sendQueue();
	}
    uploader.on("complete", function (event) {
		console.log("upload complete");
		
		file = event.file;
		filepath = './' + file.pathName;
		filepath = phpjs.str_replace('\\', '/', filepath);
		var re = phpjs.explode('.', filepath);
		var ext = phpjs.end(re);
		if (ext)
			ext = phpjs.strtolower(ext);
		setTimeout(function () {
			SVGcontent = "";
			var isGCODEfile = (ext == 'gcode' || ext == 'txt');
			isPICfile = (ext == 'jpg' || ext == 'jpeg' || ext == 'bmp' || ext == 'png');
			canSendImage = isPICfile;
			options = argv;
			if (isPICfile) {
				checkPic(file,filepath,options);
			} else {
				content = fs.readFileSync(filepath);
			//	socket.emit("percent");
				
				if (!isGCODEfile) {
					checkSVG(file,filepath,options);
				} else{
				content = content.toString();
				if (ext != 'svg')
					SVGcontent = "";
				__upload_complete(file, content, filepath);
				}
					
			}
		}, file.size / 1024 / 2);

	});
	var checkPic =function(file,filepath,options){
		var dimensions = sizeOf(filepath);
		var width = phpjs.intval(dimensions.width) / px2mm;
		var height = phpjs.intval(dimensions.height) / px2mm;
				console.log("Image width: " + dimensions.width+", height: "+ dimensions.height);
				// if (width > argv.maxCoorX || height > argv.maxCoorY || width == 0 || height == 0) {
				// 	io.sockets.emit('error', {
				// 		id: 4,
				// 		message: phpjs.sprintf('Only accept size less than %d x %d (px x px)', argv.maxCoorX * px2mm, argv.maxCoorY * px2mm)
				// 	});
				// } else {
					var image = new Jimp(filepath, function (e, image) {
						if (e) {
							fs.unlink(filepath);
							return false;

						}
						var check = pic2gcode.pic2gcode(image, options, {
							percent: function (percent) {
								socket.emit("percent", percent);
							},
							complete: function (gcode) {
								__upload_complete(file, gcode, filepath);
							}
						});
					});
				// }
	}
	var checkSVG = function(file,filepath,options,isContent){
		socket.emit("percent");
		var content;
		if(isContent) content = file;
		else	content = fs.readFileSync(filepath); 				
		var SVGcontent = content.toString();
		content = svg2gcode.svg2gcode(SVGcontent, options, function (percent) {
		});
		SVGcontent = "";
		__upload_complete(file, content, filepath);
	}

    // Error handler:
	uploader.on("error", function (event) {
		console.log("Error from uploader", event);
	});
	socket.on('disconnect', function () {
		socketClientCount--;
	});
	socket.on('start', function (copies) {
		copies = copies ||1;
		start(copies);
	});
	socket.on('requestQueue', function () {
		if (!canSendImage)
			sendQueue(socket);
		else
			sendImage(socket);
	});
	socket.on('pause', function () {
		pause();
	});
	socket.on('unpause', function () {
		unpause();		
	});
	socket.on('softReset', function () {
		softReset();
	});
	socket.on('stop', function () {
		stop();	
	});
	socket.on('cmd', function (cmd) {
		cmd = cmd || "";
		console.log(cmd);
	//	cmd = phpjs.str_repflace(['"', "'"], '', cmd);
		write2serial(cmd);
	});
	socket.on('resolution', function (resolution) {
		argv.resolution = resolution;
		io.sockets.emit("settings", argv);
	});

    socket.on('imageResize',function(size){
		if(size <0 || size >400 || size =='') size = 100;	
		if(isPICfile){ //image
			argv.scale = size;
			options = argv;
			checkPic(file,filepath,options);
		}else{ //svg
			argv.scale = size;
			options = argv;
			if(isConvert) checkSVG(toSVGContent,filepath,options,true);
			else checkSVG(file,filepath,options);

		}

	});

    socket.on('convertToSvg',function(type){
		if(!isPICfile && !isConvert) return;
		var type = parseInt(type) || 0;
		var fileconvert = filepath;
		isPICfile = false;
		isConvert = true;
		options = argv;
		switch(type){
			case 1:
				var params = {
				// threshold: 200
				};
				potrace.trace(fileconvert, function(err, svg) {
				if (err) {console.log("Convert error"); return;};
				toSVGContent = svg;
				checkSVG(toSVGContent,fileconvert,options, true);
				});
				break;
			case 2:
				var posterizer = new potrace.Posterizer();
				posterizer.loadImage(fileconvert, function(err) {
				if (err) {console.log("Convert error"); return;};
				posterizer.setParameters({
					steps: 3,
					threshold: 200,
					fillStrategy: potrace.Posterizer.FILL_MEAN,
				});
				toSVGContent = posterizer.getSVG(); 
				checkSVG(toSVGContent,fileconvert,options, true);
				});
				break;
			case 0:
				isConvert = false;
				isPICfile =true;
				checkPic(file,filepath,options);
				break;

		}

	});
	socket.on('machinehost', function (address) {
		if(argv.machinehost != address){
			argv.machinehost = address;
			io.sockets.emit("settings", argv);
			closeESP();
			openESP();
		}
		
	});

	socket.on('maxLaserPower', function (power) {
		power = phpjs.intval(power);
		if (power < 0)
			power = 0;
		else if (power > 100)
			power = 100;

		argv.maxLaserPower = power;
		console.log("change laser power to " + power + " %")
		io.sockets.emit("settings", argv);
	});
	socket.on('feedRate', function (feedRate) {
		feedRate = phpjs.intval(feedRate);
		if (feedRate <= 1) feedRate = 100;
		if (feedRate == argv.feedRate)
			return;
		fs.writeFile('./data/feedRate', feedRate);

		var replaceFeedRate = function (queue) {
			var oldFeed = 'F' + argv.feedRate;
			var newFeed = 'F' + feedRate;
			for (var i = 0; i < queue.length; i++)
				queue[i] = phpjs.str_replace(oldFeed, newFeed, queue[i]);

			write2serial(phpjs.sprintf("G01 F%.1f", phpjs.floatval(feedRate)));
		}
		replaceFeedRate(gcodeQueue);
		replaceFeedRate(gcodeDataQueue);
		argv.feedRate = feedRate;
		if (argv.feedRate == 1)
			argv.feedRate = 100;
		io.sockets.emit("settings", argv);

	});

	socket.on('maxCoordicate', function (maxCoorX,maxCoorY) {
		maxCoorX = phpjs.intval(maxCoorX);
		maxCoorY = phpjs.intval(maxCoorY);
		if (maxCoorX <= 1) maxCoorX = MAXCOOR.X;
		if (maxCoorY <= 1) maxCoorY = MAXCOOR.Y;
		if (maxCoorX == argv.maxCoorX && maxCoorY == argv.maxCoorY )
			return;
		fs.writeFile('./data/maxCoordicate', maxCoorX+","+maxCoorY);
		argv.maxCoorX = maxCoorX;
		argv.maxCoorY = maxCoorY;
		io.sockets.emit("settings", argv);

	});

    	socket.on('token', function (token, remember) {
		tokenIndexOf = tokenDevice.indexOf(token);
		if (tokenIndexOf == -1)
			tokenDevice.push(token);
		console.log(tokenDevice);
		console.log(remember);
		var rtdIndex = rememberTokenDevice.indexOf(token);
		if (rtdIndex == -1 && remember) {
			rememberTokenDevice.push(token);
			saveRememberDevice();
		} else if (!remember && rtdIndex > -1) {
			rememberTokenDevice.slice(rtdIndex, 1);
			saveRememberDevice();
		}
		console.log((tokenIndexOf == -1 ? "New" : "Old") + " device (#" + tokenDevice.indexOf(token) + ")");
	});
    
    socket.emit("settings", argv);
});

server.listen(argv.serverPort);
siofu.listen(server);

//set token from sdcard
fs.readFile('./data/rememberDevice.json', function (err, data) {
	if (err)
		saveRememberDevice();
	else {
		rememberTokenDevice = JSON.parse(data);
		tokenDevice = rememberTokenDevice.slice(0);
	}
});

if (argv.feedRate == -1)
	fs.readFile('./data/feedRate', function (err, data) {
		if (err)
			argv.feedRate = 100;
		else {
			data = phpjs.str_replace("\n", "", data);
			console.log("Feed: "+data);
			argv.feedRate = phpjs.intval(data);
			if (argv.feedRate <= 1)
				argv.feedRate = 100;
		}
	});

if (argv.maxCoorX <= 0 || argv.maxCoorY<=0)
	fs.readFile('./data/maxCoordicate', function (err, data) {
		if (err){
			argv.maxCoorX = MAXCOOR.X;
			argv.maxCoorY = MAXCOOR.Y;
		} else {
			data = phpjs.str_replace("\n", "", data).split(",");
			console.log("maxcoorX: "+data[0]+",maxCoorY: "+data[1]);
			argv.maxCoorX = phpjs.intval(data[0]);
			argv.maxCoorY = phpjs.intval(data[1]);
			if (argv.maxCoorX <= 0)
				argv.maxCoorX = MAXCOOR.X;
			if (argv.maxCoorY <= 0)
				argv.maxCoorY = MAXCOOR.Y;

		}
	});

function sendImage(socket, filepath) {
	if (filepath)
		imagePath = filepath;
	var __sendQueue = gcodeDataQueue.length < 22696;
	if (__sendQueue)
		sendQueue();
	var queueLength = gcodeDataQueue.length;
	if (socket){
        console.log("Send only one");
		socket.emit("sendImage", imagePath, __sendQueue, queueLength);
    }else{
		io.sockets.emit("sendImage", imagePath, __sendQueue, queueLength);
        console.log("Send everyone");
    }
}
function sendQueue(socket) {
	socket = socket || io.sockets;
	console.log('sendQueue');
	socket.emit('AllGcode', gcodeDataQueue, machineRunning);
	if (SVGcontent != "") {
		sendSVG(SVGcontent);
	}
}
function sendSVG(content, socket) {
	socket = socket || io.sockets;
	console.log('sendSVG');
	socket.emit('sendSVG', content);
}

var __finishSentInterval;
///goi từ send lệnh Gcode khởi đầu
function finishSent() {
	if (__finishSentInterval == undefined) {
		console.log("finish 'Sent gcode process'");
		__finishSentInterval = setInterval(function() {
			if (__sent_count == 0) {
				clearInterval(__finishSentInterval);				
				finish();
				__finishSentInterval = undefined;
			}
		}, 50);
	}
}

function finish() {
	console.log('finish');
	io.sockets.emit('finish');
	sendPushNotification("I have just finished my job! ^-^");
	stop(false);
}

function stop(sendPush) {
	__serial_queue = [];
	__sent_count = 0;
	__preProcessQueue.command = "";
	write2serial_direct("~\n");
	write2serial_direct("M5\n");
	write2serial_direct("G0X0Y0\n");
	goalPos.set(0, 0);
	sendPush = (sendPush != undefined) ? sendPush : true;
	machineRunning	= false;
	machinePause	= true;
	timer2			= 0;
	gcodeQueue 		= new Deque(gcodeDataQueue);
	currentQueue 	= 0;
	currentDistance = 0;
	stopCountingTime();
	console.log('stop!');
	setTimeout(function() {
		write2serial("~");
	}, 400);
	if (sendPush)
		sendPushNotification("The machine was stopped");
}

function sendPushNotification(message) {
	var post_data = {
		"tokens": tokenDevice,
		"notification":{
			"alert": message 
		}
	};
	var command = "curl -u " + argv.privateApiKey + ": -H \"Content-Type: application/json\" -H \"X-Ionic-Application-Id: " + argv.ionicAppId + "\" https://push.ionic.io/api/v1/push -d '" + JSON.stringify(post_data) + "'";
	exec(command);
}

function start(copies) {	
	machineRunning	= true;
	machinePause	= false;
	
	console.log("machine is running!");
	timer2 = phpjs.time();
	copies = phpjs.intval(copies);
	if(copies <=1) copies = 1;
	copiesDrawing = copies;
	if (gcodeQueue.isEmpty() && gcodeDataQueue.length > 0)
		gcodeQueue = new Deque(gcodeDataQueue.toArray());
	write2serial_direct("~\n");
	sendPushNotification("The machine has just been started!");
}

function pause() {
	machinePause = true;
	write2serial_direct("!\n");
	console.log("pause");
}

function unpause() {
	machinePause = false;
	write2serial_direct("~\n");
	console.log("unpause");
}

function stopCountingTime() {
	io.sockets.emit("stopCountingTime");
}

function is_running() {
	return machineRunning && !machinePause;
}

function softReset() {
	console.log("reset");
	write2serial("\030");
}

function sendCommand(command) {
	if (is_running())
		console.log("This machine is running, so you can't execute any command");
	else {
		command = phpjs.strval(command);
		write2serial(command);
	}
}

function getPosFromCommand(which, command) {
	var tmp = phpjs.explode(which, command);
	if (tmp.length == 1)
		return undefined;
	return phpjs.floatval(tmp[1]);
}

function sendFirstGCodeLine() {
	if (gcodeQueue.isEmpty()) {	// is empty list
		if (copiesDrawing <= 1) {
			finishSent();
			return false;
		} else {
			gcodeQueue = new Deque(gcodeDataQueue.toArray());
			copiesDrawing--;
		}
	}
	//get the last command.
	var command = gcodeQueue.shift();
	//comment filter
	command = command.split(';');
	command = command[0];
	//if command is just a command, we check again
	if (phpjs.strlen(command) <= 1 || command.indexOf(";") == 0)   //igrone comment line
		return sendFirstGCodeLine();
	command = phpjs.trim(command.replace(/[^a-zA-Z0-9-.$ ]/g, ''));
	//write command to grbl
	
	//convert command to upper style
	command = phpjs.strtoupper(command);
	
	// send gcode command to client
	io.sockets.emit("gcode", {command: command, length: gcodeQueue.length}, timer2);
	
	command = phpjs.str_replace(" ", "", command);
	write2serial(command);
	//get X and Y position from the command to count the length that the machine has run
	var commandX = getPosFromCommand('X', command);
	var commandY = getPosFromCommand('Y', command);
	if (commandX != undefined && commandY != undefined) { //if exist x or y coordinate.
		var newPos = new Vec2(phpjs.floatval(commandX), phpjs.floatval(commandY));
		currentDistance += newPos.distance(goalPos);
		goalPos.set(newPos);
	}
	currentQueue++;
	return true;
}
function sendGcodeFromQueue() {
	if ((currentDistance < maxDistance || currentQueue < minQueue || canSendImage) && currentQueue < maxQueue && __serial_queue.length < maxQueue)
		sendFirstGCodeLine();
}

function receiveData(data) {
	if (data.indexOf('<') == 0) {	//type <status,...>
		data = phpjs.str_replace(['<', '>', 'WPos', 'MPos', ':', "", "\n"], '', data);
		var data_array = phpjs.explode(',', data);
		laserPos.set(phpjs.floatval(data_array[1]), phpjs.floatval(data_array[2]));
		io.sockets.emit('position', data_array, machineRunning, machinePause,copiesDrawing);
		var __minDistance = minDistance;
		if (canSendImage)
			__minDistance <<= 8; //*2^8
		if ((laserPos.distance(goalPos) < __minDistance) || (data_array[0] == 'Idle' && gcodeQueue.length > 0)) {
			currentQueue = 0;
			currentDistance = 0;
		}

		if (!machinePause && data_array[0] == 'Hold') {
			unpause();
		}
		// if (phpjs.time() - timer3 > intervalTime5) {
		// 	if (relay) {
		// 		if (data_array[0] == 'Idle' && !is_running())
		// 			relay.off();
		// 		else
		// 			relay.on();
		// 	}

		// 	timer3 = phpjs.time();
		// }
	} else if (data.indexOf('ok') == 0) {
		if (__sent_count_direct > 0)
			__sent_count_direct--;
		else
			__sent_count--;

		if (__preProcessQueue.command == "")
			__preProcessQueue = __preProcessWrite2Serial();
		timer1 = phpjs.time();
		if (is_running()) {
			sendGcodeFromQueue();
		}
	} else if (data.indexOf('error') > -1) {
		__sent_count--;
		currentQueue--;
		io.sockets.emit('error', { id: 2, message: data });
	} else {
		io.sockets.emit('data', data);
	}

	if (__sent_count == 0) {
		__serial_free = true;
		__write2serial();
	}
}

function addQueue(list) {
	if (phpjs.is_string(list)) {
		//200% make sure list is a string :D
		list = list.toString();
		var commas = ["\r\n", "\r", "\n"];
		for (var i = 0; i < commas.length; i++)
			if (list.indexOf(commas[i]) > 0) {
				list = phpjs.explode(commas[i], list);
				break;
			}
	}

	//new queue
	gcodeQueue = new Deque(list);
	gcodeDataQueue = new Deque(list);
}

function saveRememberDevice(list) {
	list = list || rememberTokenDevice;
	fs.writeFile('./data/rememberDevice.json', JSON.stringify(list));
}

function __preProcessWrite2Serial() {
	var command = [];
	var i = 0;
	var length = 0;
	do {
		//process check serial queue is empty
		if (__serial_queue.length == 0)
			break;

		//check the length of command batch
		if (length + phpjs.strlen(__serial_queue[0].command) > argv.maxLengthCmd)
			break;

		//add command to batch
		var ele = __serial_queue.shift();
		command.push(ele.command);
		length += phpjs.strlen(ele.command);
		i++;
	} while (true);
	//console.log("over");
	command = command.join('');

	return {
		sent_count: i,
		command: command,
		length: length,
	};
}

function __write2serial(free) {
	if ((!__serial_free && free != true) || __serial_queue.length == 0) return;
	__serial_free = false;

	if (__preProcessQueue.command == "")
		__preProcessQueue = __preProcessWrite2Serial();


	__sent_count = __preProcessQueue.sent_count;
	var length = __preProcessQueue.length;
	var func = __preProcessQueue.func;
	var command = __preProcessQueue.command;
	__preProcessQueue.command = "";
	sendGcode(command);

}

var __lastCommand = "";
function write2serial(command) {
	if (__lastCommand != command || phpjs.strlen(command) < 215) {
		//add command to serial queue		
		__serial_queue.push({
			'command': command + "\n"
		});

		if (__serial_free)
			__write2serial();
	}
}

function write2serial_direct(command) {
	__sent_count_direct++;
	sendGcode(command);
}


var openESP = function() {
		var url = argv.machinehost;
		ws = new W3CWebSocket('ws://'+url);
		ws.onopen = onOpen;
		ws.onclose = onClose;
		ws.onmessage = onMessage;
		ws.onerror = onError;
	}
var closeESP = function() {
		if (ws) {
			console.log('CLOSING ...');
			ws.close();
		}
	}
var onOpen = function() {
	console.log('Connected to machine');
	var interval = setInterval(function () {
		//increase the max element in the queue
		setTimeout(function () {
			sendGcode("?");
		});
	}, intervalTime3);
	ws.onmessage  = onMessage;
};
var onClose = function() {
		console.log('close machine');
		ws = null;
	};
var buffer ='';	
var onMessage = function(e) {
	var data = '';
	if (e.data instanceof ArrayBuffer) {
		var bytes = new Uint8Array(e.data);
		for (var i = 0; i < bytes.length; i++) {
			data += String.fromCharCode(bytes[i]);
		}
	} else {
		data = e.data;
	}
	buffer += data;
	var split = buffer.split("\n");
	
	buffer = split.pop(); //last not fin data back to buffer
	for (i = 0; i < split.length; i++) {
		var response = split[i];
		// trigger line handling event here
		if (response.indexOf("ok") != -1 || response == "start\r" || response.indexOf('<') == 0) {
			receiveData(response);
		}
	}
};

var onError = function(event) {
	console.log("Can not connect to machine");
}

function sendGcode(gcode) {
	if (gcode) {
		if(ws){			
			if (ws.readyState == '1') {
				ws.send(gcode);
			} else {
				console.log("Unable to send gcode. Not connected to Websocket");
			}
		}
	}
}

var grblStatus = setInterval(function () {
	write2serial("?");
	if (is_running() && phpjs.time() - timer1 > intervalTime1){
		write2serial_direct("~\n");
		//write2serial_direct("M5\n");
		//write2serial_direct("G0X0Y0\n");
	}
}, intervalTime1);

var serverInfo = setInterval(function () {
	//serverLoad	= phpjs.trim(sh.exec("uptime | awk '{ print $10 }' | cut -c1-4").stdout);
	//tempGalileo	= phpjs.intval(sh.exec("cat /sys/class/thermal/thermal_zone0/temp | cut -c1-2").stdout);
	serverLoad = 10+Math.random()*100;
	console.log(serverLoad);
	tempGalileo = 10;
	io.sockets.emit("system_log", {
		'serverLoad': serverLoad,
		'tempGalileo': tempGalileo
	});
}, intervalTime4);

console.log('Server runing port 9090');
