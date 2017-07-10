const	px2mm	= 3.54328571429,//tỉ lệ px >mm
		eps		= 1e-3, //số  epsilon
		defaultGCode = [
			'G90',	// Absolute coordinate mode. Oxyz  Đặt hệ tọa độ tuyệt đối
			'G21',	// Unit: mm Đặt đơn vị gia công hệ met
			'G17 G94 G54', //Chọn mặt phẳng gia công XY, G94: Đặt tốc độ tiến dao/ phút, G54: Lựa chọn hệ tọa độ phôi thứ nhất 
			'S0',	//set min power 
		];
var Jimp = require("jimp"),
	phpjs= require('phpjs');

var pic2gcodeProcess;
module.exports = {
	clear		: function () {
		if (pic2gcodeProcess)
			clearTimeout(pic2gcodeProcess);
	},
	pic2gcode	: function(image, options, callback) {
		//options  lấy và thiết lập option
		options = options || {};
		options.feedRate	= options.feedRate 		|| 1000;  //tốc độ
		options.resolution	= options.resolution	|| px2mm; // độ phân giải
		options.maxCoorX	= options.maxCoorX		|| 320; /// tối đa trục X
		options.maxCoorY	= options.maxCoorY		|| 315; /// tối đa trục Y
		options.maxLaserPower = options.maxLaserPower || 100; //công suất laser
		callback			= callback || {};
		callback.percent	= callback.percent		|| null; //phần trăm tiến độ
		callback.complete	= callback.complete		|| function () {
			console.log("'pic to gcode' was complete");
		};
		var sc = options.scale ||100;
		console.log(image);
		// var time = phpjs.microtime(true);  //tính thời gian cắt
		// 	Jimp.read(image, function (err, lenna) {
		// 		if (err) throw err;
		// 		lenna.scale(sc)            // resize            // set greyscale 
		// 			.write("lena-small-bw.jpg"); // save 
		// 	});	
		//scale co chỉnh hình theo độ phân giải với độ chính xác
		var scale = options.resolution / px2mm;
		

		if (phpjs.abs(scale - 1) > eps)
			image = image.scale(scale);

		image.scale(sc).write("aa.png");
		
		//get width, height  lấy chiều dài, cao
		var width	= image.bitmap.width,
			height	= image.bitmap.height
			t = _t	= 0;	//check how we cut
			
		//function check "for by width" 
		var ok = function (j, t) {
			return (t == 0 && j < width) || (t == 1 && j >= 0);
		}
		var depth = function(color) {//1000/765/255/100 = 0.00005126233  //lấy depth theo màu ở vi trí x,y
			var dep = (765 - color.r - color.g - color.b) * color.a * options.maxLaserPower * 0.00005126233 ;
			return dep > 1000 ? 1000 : dep;
		}
		
		var getPixel = function(x, y) {   //lấy pixel (r,g,b) theo vị trí x,y 
			var idx = (y * width + x) << 2;
			var color = {
				r: image.bitmap.data[idx],
				g: image.bitmap.data[idx + 1],
				b: image.bitmap.data[idx + 2],
				a: image.bitmap.data[idx + 3]
			};
			return color;
		}
			
		
		//default gcode
		var gcode = defaultGCode.slice(0);
		gcode.push(phpjs.sprintf("G1 F%.1f", options.feedRate)); // tốc độ cắt
		
		var colorByCol = function(i) { 
			var _ok = ok(j, _t),
				start	= (t == 0) ? 0 : width - 1,
				plus	= (t == 0) ? 1 : -1,
				y		= (height - i) / options.resolution, //real y vị trí Y
				wasPlus = false,
				_t		= t,
				cut 	= false,
				_S		= 0;
			if (callback.percent)  //ra về tiến độ thực hiện
				callback.percent(i / height * 100);
			
			for (var j = start; ok(j, _t) ; j += plus) {
				var x = j / options.resolution, //real x vị trí X
					dep	= depth(getPixel(j, i)); //lấy depth
					
				if (dep > 0) {
					if (!cut) {
						cut = true;
						if (!wasPlus) { 
							t = (t + 1) % 2;
							wasPlus = true;
						}
						//start cutting
						gcode.push(phpjs.sprintf("G0 X%.3f Y%.3f", x, y)); //chạy nhanh đến vị trí x,y
						gcode.push("G1"); //cắt
					}
					//change power
					//if (dep != _S) {
						gcode.push("M03");  //trục chính quay theo chiều kim đồng hồ
						gcode.push("S" + phpjs.round(dep)); //set công suất theo depth
						_S = dep;
						gcode.push("X" + phpjs.round(x, 3));
						gcode.push("M05"); //tắt laser
					//}
				} else {
					if (cut) {
						//stop cutting
						_S = 0;
						cut = false;
					}
				}	
			}
			if (cut)
				gcode.push("M05"); //make sure the laser is off
			i++;
			if (i == height) {
				gcode.push("G0 X0 Y0"); //chạy nhanh về 0,0
				console.log(";Time ext: " + (phpjs.microtime(true) - time)); //thông báo thời gian cắt
				if (callback.complete)
					callback.complete(gcode);
				return;
			} else {			
				pic2gcodeProcess = setTimeout(function() {
					colorByCol(i);
				}, 0);
			}	
		}
		colorByCol(0);
	}
}