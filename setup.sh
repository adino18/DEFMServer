echo "Installing DEFM server..."
path=$(pwd)
auto_script_filename=auto_start_when_boot_DEFMServer
auto_script_location=/etc/init.d/$auto_script_filename
echo "Now path is: $path"



echo "Create a auto start bash shell"
echo "#!/bin/bash" > $auto_script_location
echo "sleep 15 && cd $path/bin && ./checkDEMServeralive.sh > /dev/null 2>&1 &" >> $auto_script_location
echo "exit 0" >> $auto_script_location
chmod 0755 $auto_script_location
update-rc.d $auto_script_filename defaults

#install ppp-mppe
echo "Install ppp_mppe kernel support!"
opkg install $path/bin/kernel/kernel-module-ppp-mppe_3.8-r0_quark.ipk


#install pptpclient
wget "http://k1.arduino.vn/img/2015/08/28/0/1561_123450-1440778374-0-pptp-1.8.0.zip" -O pptp.zip
unzip pptp.zip
cd pptp* && make 
make clean && make && make install && cd ..
rm pptp* -rf

npm install galileo-io

echo ""
echo ""
echo ""
echo "You're done!"
echo "Now run ./defmserver.js to run the server"
