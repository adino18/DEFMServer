const 	unitConst = {   // các đơn vị
			'mm': 	1,
			'in':   25.4000008381,
			'pt':   0.35277777517,
			'm' :   1000,
			'cm':   10,
			'ft':   304.799827588,
			'pc':   4.23333093872,
			'px':   0.28222222222
			
		},
		defaultGCode = [
			'G90',	// Absolute coordinate mode. Oxyz   Đặt hệ tọa độ tuyệt đối
			'G21',	// Unit: mm   Đặt đơn vị gia công hệ met
			'G17 G94 G54', //G17: Chọn mặt phẳng gia công XY, G94: Đặt tốc độ tiến dao/ phút, G54: Lựa chọn hệ tọa độ phôi thứ nhất 
		];
var SVGReader	=	require('./SVGReader'),
	phpjs		=	require('phpjs');

module.exports = {
	svg2gcode : function(svg, settings) { //lấy setting và các thuộc tinh của hình
		// clean off any preceding whitespace  xóa các code ko dúng
		svg = svg.replace(/^[\n\r \t]/gm, '');
		settings = settings || {};
		console.log("settingscale 1: "+ settings.scale); 
		settings.scale = settings.scale || unitConst.px;	// scale 
		settings.feedRate = settings.feedRate || 1400;	//engraving speed
	    settings.feedRate = phpjs.sprintf("%.1f", phpjs.floatval(settings.feedRate));
		settings.maxLaserPower = settings.maxLaserPower || 100;
		console.log("settingscale 2: "+ settings.scale); 
		var
			scale=function(val) {             ///scale hình dựa trên setting
	    		return val * settings.scale
	  		},
			SVGDom = require('domino').createWindow(svg).document,  //tạo svg DOM
	  		gcode,
	  		path,	  		
			svgSelector = SVGDom.querySelector('svg'),
			pageHeight,
			originPageHeight,
			pageWidth;
		if (svgSelector) {
			pageHeight = svgSelector.getAttribute("height");	//pageHeight for adjust Y coordinate    //lấy chiều cao cho trục Y
			originPageHeight = pageHeight
			pageWidth = svgSelector.getAttribute("width")   ///chiều dài trục X
		}
		var unit;
		if (pageHeight) {	//kiểm tra chiều cao hình. ko dúng set default = 297
			var ok = false;
			for (unit in unitConst) {
				if (pageHeight.indexOf(unit) > -1) {
					ok = true;
					pageHeight = phpjs.floatval(pageHeight) * unitConst[unit];
					break;
				}
					
			}
			if (!ok) {
				pageHeight = phpjs.floatval(pageHeight) * unitConst.px;
				unit = 'px';
			}
		} else {	
	 		pageHeight = 297;
	 		unit = 'px';
	 	}
	//	console.log("pageheight: "+ pageHeight);
	//	console.log("orgpageheight: "+ originPageHeight);
	//	console.log("pageW: "+ pageWidth);
		var convertConst = unitConst[unit] / unitConst.px;   //tỉ lệ đơn vị hình/px
		var vbX = 1, vbY = 1;
		if (svgSelector) {   //lấy dữ liệu viewBox
			var viewBox = svgSelector.getAttribute("viewBox");   // có dạng viewbox="x x x x" với x là số
			viewBox = phpjs.explode(" ", viewBox);
			for (var i = 0; i < viewBox.length; i++)
				viewBox[i] = phpjs.floatval(viewBox[i]);
			vbX = phpjs.floatval(pageWidth) * convertConst / viewBox[2];   //viewbox x
			vbY = phpjs.floatval(originPageHeight) * convertConst / viewBox[3]; //viewbox x
		}
	//	console.log("vbX: "+ vbX);
//console.log("vbY: "+ vbY);
	//	//get all paths
		var paths = SVGReader.parse(svg, {vbX: vbX, vbY: vbY}).allcolors;   //chuyển đổi svg sang hình đường dẫn phẳng (flat path)

		if (paths.length > 0) {    //sap xep lại đường đi
			paths.sort(function(a, b) {
			//	console.log("a[0] 1: "+ a[0]);
			//	console.log("b[0] 1: "+ b[0]);
			//	console.log("sort 1: "+ a[0].x - b[0].x);
				return a[0].x - b[0].x;
			});

			paths.sort(function(a, b) {
				
			//	console.log("a[0] 2 : "+ a[0]);
			//	console.log("b[0] 2: "+ b[0]);
			//	console.log("sort 1: "+ b[0].y - a[0].y);
				return b[0].y - a[0].y;
			});

			var minX =paths[0][0].x | 0;
			var maxY =0;
			for(var i = 0;i<paths.length;i++){
				var path = paths[i];
				for(var j=0;j<path.length;j++){
					var point = path[j];
				//console.log("XX:" +path.a);
				var x = Math.min(point.x);
				//console.log(x);
				var y = Math.min(point.y);
				if(minX >x) minX = x;
				if(maxY < y) maxY = y;
				}
				
				
			}
			console.log("minX"+minX);
			console.log("minY"+ maxY);
			//console.log("pathaaa"+paths);
		//	console.log("path length: "+ paths.length);
			for (var i = 1; i < paths.length; i++) {   //sap xep lại đường đi theo khoảng cách
				var t = i;
				for (var j = t + 1; j < paths.length; j++) {
					var lastPos = paths[i - 1].length - 1;
					//console.log("lastpost:" + lastPos);
					//console.log("patha"+i +": " + paths[i - 1][lastPos].distance(paths[j][0]));
					//console.log("pathb:"+i +": "  + paths[i - 1][lastPos].distance(paths[t][0]));
					if (paths[i - 1][lastPos].distance(paths[j][0]) < paths[i - 1][lastPos].distance(paths[t][0]))
						t = j;
				}
				
				var tmp = paths[i];
				paths[i] = paths[t];
				paths[t] = tmp;
			//	console.log("pathaa"+i +": " + paths[i - 1]);
			//	console.log("pathbb:"+i +": "  + paths[i - 1]);

			}
		}

		
		
	  	gcode = defaultGCode.slice(0); /// đặt các lệnh mặt dịnh
		gcode.push("S" + (10 * settings.maxLaserPower)); //set công suất laser
		gcode.push(phpjs.sprintf("G01 F%.1f", settings.feedRate)); //set tốc độ cắt
		var prevX = 0;
		var prevY = 0;
		//pageHeight = 300;
		//console.log("Max:"+max);
	  	for (var pathIdx = 0, pathLength = paths.length; pathIdx < pathLength; pathIdx++) {
	    	path = paths[pathIdx];

	    	// seek to index 0  //cho đầu cắt về 0,0
			prevX = scale(path[0].x-minX+1).toFixed(3);  
			prevY = (scale(-path[0].y+maxY+1)).toFixed(3);
	    	gcode.push(['G00',
	      		'X' + prevX,
	      		'Y' + prevY,
	    	].join(' '));
		//	console.log("path0:" + path[0]);
			//console.log("path0X:" + path[0].x);
			//console.log("path0y:" + path[0].y);
			/////console.log("prevX:" + prevX);
			//console.log("prevX:" + prevY);
	
	      	// begin the cut by dropping the tool to the work // 
	      	gcode.push('M03'); //trục chính quay theo chiều kim đồng hồ
			gcode.push("G01"); //Chạy theo đường thẳng có cắt gọt
	      	// keep track of the current path being cut, as we may need to reverse it
	      	var localPath = [];
	      	for (var segmentIdx=0, segmentLength = path.length; segmentIdx<segmentLength; segmentIdx++) {
	        	var segment = path[segmentIdx];
				var nowX = scale(segment.x-minX+1).toFixed(3); //vị trí X hiện tại
				var nowY = (scale(-segment.y+maxY+1)).toFixed(3); //vị trí X hiện tại
				var localSegment = [];
				if (nowX != prevX) {
					localSegment.push("X" + nowX);
					prevX = nowX;
				}
				if (nowY != prevY) {
					localSegment.push("Y" + nowY);
					prevY = nowY;
				}
	
		        // feed through the material
		        if (localSegment.length > 0)
					gcode.push(localSegment.join(' '));
		
	        }

	    	// turn off the laser
	    	gcode.push('M05'); //Quay và dừng trục chính
	  	}
	
	
		// go home
		gcode.push('G00 X0 Y0'); ///Chạy nhanh không cắt gọt về 0,0

		return gcode.join("\r\n");
	}
};