'use strict';

(function () {

	//======================
	// General
	//======================

	var getRequestCounter = function () {
		var returnValue = $.sessionStorage.isSet('OmegaRequestCounter') ? $.sessionStorage.get('OmegaRequestCounter') : 0;
		$.sessionStorage.set('OmegaRequestCounter', returnValue + 1);
		return returnValue;
	};

	var isTokenExpired = function () {
		if ($.sessionStorage.isSet('OmegaTokenExpires')) {
			return (new Date()).getTime() > $.sessionStorage.get('OmegaTokenExpires');
		} else {
			return true;
		}
	};

	var sendUbusRequest = function (packageName, methodName, params, callback) {
		callback = callback || $.noop;

		if (!isTokenExpired()) {
			$.sessionStorage.set('OmegaTokenExpires', (new Date()).getTime() + 300000);
		}

		var request = $.ajax({
			type: 'POST',
			contentType: 'application/json',
			url: window.location.origin + '/ubus',
			data: JSON.stringify({
				jsonrpc: '2.0',
				id: getRequestCounter(),
				method: 'call',
				params: [
					$.sessionStorage.isSet('OmegaToken') ? $.sessionStorage.get('OmegaToken') : '00000000000000000000000000000000', 
					packageName, 
					methodName, 
					params
				]
			}),
			dataType: 'json'
		});

		request.done(function (data) {
			callback(data);
		});

		request.fail($.noop);
		request.always($.noop);

		return request;
	};


	//======================
	// Step 1: Login
	//======================

	var showLoginMessage = function (message) {
		$('#login-message').append($('<div class="alert alert-warning alert-dismissible fade in" role="alert"> \
			<button type="button" class="close" data-dismiss="alert" aria-label="Close"> \
				<span aria-hidden="true">&times;</span> \
				<span class="sr-only">Close</span> \
			</button> \
			<strong>Error:</strong> ' + message + ' \
		</div>'));
	};

	$('#login-form').submit(function (e) {
		e.preventDefault();

		sendUbusRequest('session', 'login', {
			username: $('#login-username').val(),
			password: $('#login-password').val()
		}, function (data) {
			console.log(data);
			if (data && data.error) {
				showLoginMessage(data.error.message);

			} else if (data && data.result) {
				var returnCode = data.result[0];

				if (returnCode === 0) {
					$.sessionStorage.set('OmegaToken', data.result[1].ubus_rpc_session);
					$.sessionStorage.set('OmegaTokenExpires', (new Date()).getTime() + data.result[1].expires * 1000);

					gotoStep(1);
				} else {
					showLoginMessage('Login failed.');
				}
			}
		});
	});

	$('#login-username').keypress(function (e) {
		if (e.which === 13) {
			e.preventDefault();
			$('#login-password').focus();

			return false;
		}
	});


	//======================
	// Step 2: Setup Wi-Fi
	//======================

	var availableWifiNetworks,
		omegaOnline = false;

	var showWifiMessage = function (type, message) {
		$('#wifi-message').append($('<div class="alert alert-' + type + ' alert-dismissible fade in" role="alert"> \
			<button type="button" class="close" data-dismiss="alert" aria-label="Close"> \
				<span aria-hidden="true">&times;</span> \
				<span class="sr-only">Close</span> \
			</button> \
			' + message + ' \
		</div>'));
	};
	
	var addWirelessNetwork = function () {
			sendUbusRequest('uci', 'add', {
				config: 'wireless',
				type: 'wifi-iface'
			}, function (result) {
				console.log('uci add wireless result:', result);
				if (result.result[0] === 0) {
					sendUbusRequest('uci', 'commit', {
							config: 'wireless'
					}, function (result) {
						if (result.result[0] === 0) {
							console.log('connected');
						} else {
							console.log('Unable to add wireless network.');
						}
					});
				} else {
					console.log('Unable to add wireless network.');
				}
			});
	};
	
	var genUciNetworkParams = function (ssid, auth, password, bApNetwork, bEnabled) {
		var params = {};
		// set the basic info
		params.device 		= 'radio0'
		params.ssid 		= ssid;
		params.encryption 	= auth;
		// set the network parameters based on if AP or STA type
		if (bApNetwork) {
			params.network 	= 'wlan';
			params.mode 	= 'ap';
		} else {
			params.network 	= 'wwan';
			params.mode 	= 'sta';
		}				
		// generate the values to set based on the encryption type
		if (auth === 'wep') {
			params.key 		= '1';
			params.key1 	= password;
		}
		else if (auth === 'psk' || auth === 'psk2') {
			params.key 		= password;
		}
		else {
			params.key 		= '';
		}
		// enable or disable
		if (bEnabled) {
			params.disabled = '0'
		} else {
			params.disabled = '1'
		}
		return params;
	};
	
	var setWirelessNetwork = function (sectionName, params) {
			sendUbusRequest('uci', 'set', {
				config: 'wireless',
				section: sectionName,
				values: params
			}, function (result) {
				console.log('uci set wireless result:', result);
				if (result.result[0] === 0) {
					sendUbusRequest('uci', 'commit', {
							config: 'wireless'
					}, function (result) {
						if (result.result[0] === 0) {
							console.log('Wireless set');
						} else {
							console.log('Unable to edit wireless network settings.');
						}
					});
				} else {
					console.log('Unable to edit wireless network settings.');
				}
			});
	};


	var setupWifiNetwork = function (ssid, password, auth, uciId) {
		if (uciId == null) {
			var uciId 			= -1;
		}
		var wifiSectionName = '@wifi-iface[' + uciId + ']'
		// setup the wifi-iface
		var params 			= genUciNetworkParams(ssid, auth, password, false, true);
		var wirelessPromise	= setWirelessNetwork(wifiSectionName, params);
	};
	
	// Check to see if the Omega is online!!
	var checkOnlineRequest;
	var isOnline = function (callback) {
		console.log('checking online...');

		if (checkOnlineRequest) {
			checkOnlineRequest.abort();
			checkOnlineRequest = null;
		}

		checkOnlineRequest = sendUbusRequest('file', 'exec', {
			command: 'wget',
			params: ['--spider', 'http://repo.onion.io/omega2/images']
		}, function (data){
			checkOnlineRequest = null;

			if (data.result[1].code === 0) {
				omegaOnline = true;
			}
			callback(data);
		});
			
	};

	var showScanMessage = function (message) {
		$('#wifi-select').empty();
		$('#wifi-select').append($('<option value="" disabled selected>' + message + '</option>'));
	};

	var scanWifiNetwork = function () {
		showScanMessage('Scanning...');
		$('#wifi-scan-btn').prop('disabled', true);
		$('#wifi-scan-icon').addClass('rotate');

		sendUbusRequest('onion', 'wifi-scan', {
			device: 'wlan0'
		}, function (data) {
			$('#wifi-scan-icon').removeClass('rotate');
			$('#wifi-scan-btn').prop('disabled', false);

			if (data && data.error) {
				showScanMessage('No Wi-Fi network found');

			} else if (data && data.result) {
				var returnCode = data.result[0];

				if (returnCode === 0 && data.result[1].results.length !== 0) {
					availableWifiNetworks = data.result[1].results;
					
					showScanMessage('Choose Wi-Fi Network:');

					for (var i = 0; i < availableWifiNetworks.length; i++) {
						if (availableWifiNetworks[i].ssid) {
							$('#wifi-select').append($('<option value="' + i + '">' + availableWifiNetworks[i].ssid + '</option>'));
						}
					}
				} else {
					showScanMessage('No Wi-Fi network found');
				}
			}
		});
	};

	$('#wifi-scan-btn').click(scanWifiNetwork);

	$('#wifi-select').change(function () {
		var index = $('#wifi-select').val();
		var network = availableWifiNetworks[index];

		$('#wifi-ssid').val(network.ssid);
		$('#wifi-key').val('');

		if (network.encryption === 'none') {
			$('#wifi-encryption').val('none');
		} else if (network.encryption.indexOf('WPA2') !== -1) {
			$('#wifi-encryption').val('psk2');
		} else if (network.encryption.indexOf('WPA') !== -1) {
			$('#wifi-encryption').val('psk');
		} else if (network.encryption.indexOf('WEP') !== -1) {
			$('#wifi-encryption').val('wep');
		}
	});

	$('#wifi-form').submit(function (e) {
		e.preventDefault();
		$('#wifi-message > .alert').alert('close');
			
		var postCheck = function () {
			clearInterval(animationInterval);
			$('#wifi-config-button').html('Configure Wi-Fi');
			$('#wifi-config-button').prop('disabled', false);
		};

		$('#wifi-config-button').prop('disabled', true);
		$('#wifi-config-button').html('Configuring');

		var animationInterval = setInterval(function () {
			var label = $('#wifi-config-button').html();
			$('#wifi-config-button').html(label.length < 14 ? label + '.' : 'Configuring');
		}, 1000);
		
		
		if ($('#wifi-encryption').val() === 'psk2' || $('#wifi-encryption').val() === 'psk'){
			if($('#wifi-key').val().length < 8 || $('#wifi-key').val().length > 63){
				if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessage('danger', 'Please enter a valid password. (WPA and WPA2 passwords are between 8 and 63 characters)');
			}
			
		}else if($('#wifi-encryption').val() === 'wep'){
			if($('#wifi-key').val().length !== 5){
				if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessage('danger', 'Please enter a valid password. (WEP passwords are 5 or 13 characters long)');
			}else if($('#wifi-key').val().length !== 13){
				if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessage('danger', 'Please enter a valid password. (WEP passwords are 5 or 13 characters long)');
			}
		}
		if(checkOnlineRequest !== null){
			var connectionCheckInterval = setInterval(function () {
				isOnline(function () {
					if (omegaOnline) {
						clearTimeout(connectionCheckTimeout);
						clearInterval(connectionCheckInterval);
						
						sendUbusRequest('file', 'exec', {
							command: '/etc/init.d/device-client',
							params: ['restart']
						}, function () {
						// Initiate firmware upgrade
						console.log("Checking for upgrade");
						sendUbusRequest('onion', 'oupgrade', {
							params: {
								check: ''
							}
						}, function (data) {
							binName = data.result[1].image.local;
							upgradeRequired = data.result[1].upgrade;
							postCheck();
							gotoStep(2);
						});
					});
					}
				});
			}, 10000);

			var connectionCheckTimeout = setTimeout(function () {
				clearInterval(connectionCheckInterval);
				if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}

				postCheck();
				showWifiMessage('warning', 'Unable to connect to ' + $('#wifi-ssid').val() + '. Please try again.');
			}, 60000);
			
			
			//Connect to the network
			addWirelessNetwork();
			setupWifiNetwork($('#wifi-ssid').val(), $('#wifi-key').val(), $('#wifi-encryption').val());

		}
	});

	$('#skipStepTestButton').click(function(){
		console.log("skipStepTestButton gets called");
		gotoStep(2);
	});


	// ==================
	// Step 3: Cloud Registration
	//===================
	$('#setupCloudButton').click(function(){
		//Open the window.
		var win = window.open("https://google.com");
		// steps[3].init();
		gotoStep(3)
	});

	$('#skipCloudReg').click(function(){
		// steps[3].init();
		gotoStep(3);
	})

	$('#setupCloudBackButton').click(function(){
		console.log("Back Button from the cloud setup gets called");
		gotoStep(1);
	})

	var showCloudRegMessage = function (message) {
		$('#cloudRegMessage').append($('<div id="cloudErrorMsg" class="alert alert-warning alert-dismissible fade in" role="alert"> \
			<button type="button" class="close" data-dismiss="alert" aria-label="Close"> \
				<span aria-hidden="true">&times;</span> \
				<span class="sr-only">Close</span> \
			</button> \
			<strong>Error:</strong> ' + message + ' \
		</div>'));

		setTimeout(function(){
			$('#cloudErrorMsg').remove();
		},15000);
	};

	//======================
	// Step 4: Firmware Update
	//======================
	var bFirmwareUpdated = true;

	var bFirmwareDownloaded = true;


	var binName,
		binDownloaded = false,
		upgradeRequired = false;

	var checkDownload = function () {
		if (!binDownloaded) {
			var checkDownloadInterval = setInterval(function () {
				sendUbusRequest('file', 'stat', {
					path: binName
				}, function (data) {
					if (data && data.result.length === 2) {
						$('#download-progress').prop('value', data.result[1].size);

						if (data.result[1].size === 16252928) {
							binDownloaded = true;
							clearInterval(checkDownloadInterval);
							gotoStep(4);
						}
					}
				});
			}, 1000);
		}
		else {
			// no upgrade download required
			setTimeout(function(){
				gotoStep(4);
			},1000);
		}
	};

	$('#upgradeFirmwareButton').click(function(){
		var isChecked = $('#consoleInstall').is(':checked');
		console.log(isChecked);
		// Do Something with this info. Change some uci setting.
	});

	$('#skipFirmwareStep').click(function(){
		console.log("Skip Firmware Step Button is clicked");
		upgradeRequired = false;
		console.log(upgradeRequired);
		// The last page behaves differently depending on which case was passed in. 
		// Makes sense to add a new case for this.
		gotoStep(4);
	});

	$('#firmwareBackButton').click(function(){
		console.log("firmware back button gets called");
		gotoStep(2);
	})


	//=====================
	//Step 5: Setup Complete
	//======================

	$('#completeBackButton').click(function(){
		console.log("complete back button gets called");
		gotoStep(3);
	})


	//======================
	// Steps Management
	//======================

	var currentStep;

	var steps = [
		{
			ready: function () {
				return true;
			},
			init: function () {
				$.sessionStorage.remove('OmegaRequestCounter');
				$.sessionStorage.remove('OmegaToken');
				$.sessionStorage.remove('OmegaTokenExpires');

				$('#login-username').val('');
				$('#login-password').val('');
				$('#login-message').html('');
			}
		},
		{
			ready: function () {
				return $.sessionStorage.isSet('OmegaToken') && !isTokenExpired();
				// return true;
			},
			init: function () {
				// Check if the token is valid
				sendUbusRequest('system', 'info', {}, function (data) {
					if (data.result && data.result.length === 2) {
						$('#wifi-ssid').val('');
						$('#wifi-key').val('');
						scanWifiNetwork();
					} else {
						gotoStep(0);
					}
				});

				//Check to see if you can skip here

				sendUbusRequest('uci','get',{config:"onion",section:"cloud",option:"setup"},function(response){
					console.log(response);
					response.result = [0,{}];
					response.result[1].value = 1;
					console.log(response);
					if(response.result.length == 2){
						//Got a valid response, cuz the length is two
						if(response.result[1].value == 1){
							console.log("Skip Buttons should be visible");
							//If value is 1, the setup has been run before and all skip buttons are enabled.
							$('#skipStepTestButton').css('display','block');
							$('#skipFirmwareStep').css('display','block');
							//Fuck it while we are at it, lets add the back buttons here too? Or should we always have back buttons?
						}else{
							console.log("Skip Buttons are hidden");
							//If value is 0, the setup has NOT been run before and all skip buttons are disabled except for cloudSetup one. 
							$('#skipStepTestButton').css('display','none');
							$('#skipFirmwareStep').css('display','none');
						}
					} else{
						console.log("Got a wack response from the ubus request, hid all skip buttons");
						//If there is an error, assume it is a first time setup
						$('#skipStepTestButton').css('display','none');
						$('#skipFirmwareStep').css('display','none');

					}
				});
			}
		},
		{
			ready: function(){
				console.log("Ready Function for the cloud registration step gets called here");
				return true;
				// var devIdFound = false;
				// $('#setupCloudButton').attr("disabled",true);
				// $('#skipCloudReg').attr("disabled",true);
				
				// var checkForId = setInterval(function(){
				// 	sendUbusRequest('uci','get',{config:"onion",section:"cloud",option:"deviceId"}, function(response){
				// 		console.log(response);
				// 		if(response.result.length == 2) {
				// 			console.log("deviceId",response.result[1].value);
				// 			devIdFound = true;
				// 			console.log("deviceId found, cloudSetup successful");

				// 		} else{
				// 			// $('#setupCloudButton').attr("disabled",true);
				// 			// showCloudRegMessage('Unable to register device with cloud. Try Again Later!');
				// 			console.log("Cloud Setup Failed");
							
				// 		}
				// 	});
				// },500);

				// setTimeout(function(){
				// 	clearInterval(checkForId)
				// 	$('#cloudLoading').css('display','none');
				// 	$('#skipCloudReg').attr("disabled",false);
				// 	if(devIdFound){
				// 		$('#setupCloudButton').attr("disabled",false);
				// 		return true;
				// 	}else{
				// 		showCloudRegMessage('Unable to register device with cloud. Try Again Later!');
				// 		return true;
				// 	}
				// },5000);



			},
			init: function(){
				console.log("init function for tjhe cloud registration step gets called here ");
				$('#cloudLoading').css('display','block');
				var devIdFound = false;
				$('#setupCloudButton').attr("disabled",true);
				$('#skipCloudReg').attr("disabled",true);
				
				var checkForId = setInterval(function(){
					sendUbusRequest('uci','get',{config:"onion",section:"cloud",option:"deviceId"}, function(response){
						console.log(response);
						if(response.result.length == 2) {
							console.log("deviceId",response.result[1].value);
							devIdFound = true;
							console.log("deviceId found, cloudSetup successful");

						} else{
							// $('#setupCloudButton').attr("disabled",true);
							// showCloudRegMessage('Unable to register device with cloud. Try Again Later!');
							console.log("Cloud Setup Failed");
							
						}
					});
				},500);

				setTimeout(function(){
					clearInterval(checkForId)
					$('#cloudLoading').css('display','none');
					$('#skipCloudReg').attr("disabled",false);
					if(devIdFound){
						$('#setupCloudButton').attr("disabled",false);
						return true;
					}else{
						showCloudRegMessage('Unable to register device with cloud. Try Again Later!');
						return true;
					}
				},5000);
				//Run a function to see if the device is setup with the cloud.
				//If it is not, grey out the setupCloud Button and make it not clickable
				//If it is, change its color.
			}

		},
		{
			ready: function () {
				return omegaOnline;
				// return true;
			},
			init: function () {
				console.log("upgradeRequired",upgradeRequired);
				console.log("binDownloaded",binDownloaded);

				if(upgradeRequired == "false"){
					$('#upgradeFirmwareButton').html('Install Console');
				}
				if(binDownloaded == false){
					$('#download-progress').css('display','none');
				}


				// $('#download-progress').prop('value', 0);
				// binDownloaded = false;

				// if (upgradeRequired === 'true') {
				// 	// Actually start the upgrade!
				// 	console.log("Upgrading");
				// 	sendUbusRequest('onion', 'oupgrade', {
				// 		params: {
				// 			force: ''
				// 		}
				// 	});
				// }
				// else {
				// 	// No need to upgrade
				// 	console.log("No upgrade required");
				// 	$('#steps').children().eq(2).hide();	//little hacky
				// 	binDownloaded = true;
				// }

				// checkDownload();
			}
		},
		{
			ready: function () {
				return binDownloaded;
			},
			init: function () {
				if (upgradeRequired === 'true') {
					$('#upgrade-not-required').hide();
					$('#upgrade-required').show();
				} else {
					$('#upgrade-required').hide();
					$('#upgrade-not-required').show();
				}
			}
		}
	];

	var gotoStep = function (step) {
		if (currentStep !== step) {
			currentStep = step;

			var indicators = $('#steps-indicator').children(),
				controls = $('#steps').children();

			for (var i = 0; i < indicators.length; i++) {
				if (i <= step) {
					$(indicators[i]).addClass('completed');
				} else {
					$(indicators[i]).removeClass('completed');
				}
			}

			steps[step].init();
			$(controls).hide();
			$(controls[step]).show();
		}
	};

	$(function () {
		// Check which step we are in
		for (var i = 0; i < steps.length; i++) {
			// Test to see if current Step finished
			if (!steps[i].ready()) {
				break;
			}
		}

		gotoStep(i - 1);
	});
})();
