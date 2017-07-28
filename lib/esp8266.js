var W3CWebSocket = require('websocket').w3cwebsocket;
var ws = new W3CWebSocket('ws://192.168.100.1:81'); //default;

var buffer ='';
    var openESP = function(argv) {
		var url = argv.machinehost;
		ws = new W3CWebSocket('ws://'+url);
		ws.onopen = onOpen;
		ws.onclose = onClose;
		ws.onmessage = onMessage;
		ws.onerror = onError;
	};
    var closeESP = function() {
		if (ws) {
			console.log('CLOSING ...');
			ws.close();
		}
	};
    var sendGcode = function(gcode) {
        if (gcode) {
            if (ws.readyState == '1') {
                ws.send(gcode);
            } else {
                console.log("Unable to send gcode: Not connected to Websocket: " + gcode);
            }
        }
            
        
    };
    
var onOpen = function() {
		console.log('Connect to machine');
		var interval = setInterval(function () {
		//increase the max element in the queue
		setTimeout(function () {
			sendGcode("?");
		});

	}, 610);

	///
		ws.onmessage  = onMessage;
	};
var onClose = function() {
		console.log('close machine');
		ws = null;
	};
	
var onMessage = function(e) {
		var data = "";
		if (e.data instanceof ArrayBuffer) {
			var bytes = new Uint8Array(e.data);
			for (var i = 0; i < bytes.length; i++) {
				data += String.fromCharCode(bytes[i]);
			}
		} else {
			data = e.data;
		}
		buffer += data
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

