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
	// Introductory Card
	//======================

	$('#skipIntro').click(function(e){
		gotoStep(nextStep);
	});

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
		$('#loginButton').prop('disabled', true);
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

					gotoStep(nextStep);
				} else {
					$('#loginButton').prop('disabled', false);
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
		fileSize = '0',
		omegaOnline = false,
		apNetworkIndex,
		currentNetworkIndex,
		currentNetworkSsid;
		
	//Used to display error messages in an alert box
	var showWifiMessage = function (type, message) {
		$('#wifi-message').append($('<div class="alert alert-' + type + ' alert-dismissible fade in" role="alert"> \
			<button type="button" class="close" data-dismiss="alert" aria-label="Close"> \
				<span aria-hidden="true">&times;</span> \
				<span class="sr-only">Close</span> \
			</button> \
			' + message + ' \
		</div>'));
	};

	//Used to display error messages in an alert box
	var showWifiMessageModal = function (type, message) {
		$('#wifi-message-modal').append($('<div class="alert alert-' + type + ' alert-dismissible fade in" role="alert"> \
			<button type="button" class="close" data-dismiss="alert" aria-label="Close"> \
				<span aria-hidden="true">&times;</span> \
				<span class="sr-only">Close</span> \
			</button> \
			' + message + ' \
		</div>'));
	};
	
	//Adds an empty network config to the wireless config file
	var addWirelessNetwork = function (params) {
		var overwrite = 0;
		var overwriteIndex;
		$.each(savedWifiNetworks, function(key, value) {
			if(value.ssid === params.ssid){
				overwriteIndex = key;
				overwrite = 1;
			}
		});
		if(overwrite === 1){
			sendUbusRequest('uci', 'set', {
				config: 'wireless',
				section: savedWifiNetworks[overwriteIndex][".name"],
				values: params
			}, function (result) {
					sendUbusRequest('uci', 'set', {
						config: 'wireless',
						section: savedWifiNetworks[apNetworkIndex][".name"],
						values: {
							ApCliSsid: savedWifiNetworks[overwriteIndex].ssid,
							ApCliAuthMode: savedWifiNetworks[overwriteIndex].encryption,
							ApCliPassWord: savedWifiNetworks[overwriteIndex].key
						}
					}, function(response){
						sendUbusRequest('uci', 'commit', {
								config: 'wireless'
						}, function (response){
							currentNetworkSsid = savedWifiNetworks[overwriteIndex].ssid;
							sendUbusRequest('file', 'exec', {
								command: 'wifi',
								params: []
							}, function(){
								refreshNetworkList();
							});
						});
					});
				});
		}else {
			sendUbusRequest('uci', 'add', {
				config: 'wireless',
				type: 'wifi-config',
				values: params
			}, function (result) {
				console.log('uci add wireless result:', result);
				if (result.result[0] === 0) {
					sendUbusRequest('uci', 'commit', {
							config: 'wireless'
					}, function (result) {
						if (result.result[0] === 0) {
							savedWifiNetworks = [];
							sendUbusRequest('uci','get',{config:"wireless"},function(response){
								$.each( response.result[1].values, function( key, value ) {
									savedWifiNetworks.push(value);
								});
								$.each(savedWifiNetworks, function(key, value) {
									if(value.mode === "ap"){
										currentNetworkSsid = value.ApCliSsid
										apNetworkIndex = Number(value['.index']);
										return;
									}
									if(key === savedWifiNetworks.length-1){
										refreshNetworkList();
									}
								});
								console.log('added wireless network');
							});
						} else {
							console.log('Unable to add wireless network.');
						}
					});
				} else {
					console.log('Unable to add wireless network.');
				}
			});
		}
	};
	
	//Generates the parameters for the uci set wireless ubus call
	var genUciNetworkParams = function (ssid, password, auth, bApNetwork, bEnabled) {
		var params = {};
		// set the basic info
		params.ssid 		= ssid;
		params.encryption 	= auth;
		// set the network parameters based on if AP or STA type	
		// generate the values to set based on the encryption type
		if (auth === 'wep') {
			params.encryption 	= auth;
			params.key 		= '1';
			params.key1 	= password;
		}
		else if (auth === 'psk') {
			params.encryption 	= 'WPA1PSK';
			params.key 		= password;
		}
		else if (auth === 'psk2') {
			params.encryption 	= 'WPA2PSK';
			params.key 		= password;
		}
		else {
			params.encryption 	= 'NONE';
			params.key 		= '';
		}

		return params;
	};
	
	//Uses ubus to uci set the wireless with the genUciNetworkParams and enables the configuration
	// var setWirelessNetwork = function (sectionName, params) {
			// sendUbusRequest('uci', 'set', {
				// config: 'wireless',
				// section: savedWifiNetworks[currentNetworkIndex][".name"],
				// values: {
					// disabled = "1"
				// }
			// }, function(){
			// 	sendUbusRequest('uci', 'set', {
			// 		config: 'wireless',
			// 		section: sectionName,
			// 		values: params
			// 	}, function (result) {
			// 		console.log('uci set wireless result:', result);
			// 		if (result.result[0] === 0) {
			// 			sendUbusRequest('uci', 'commit', {
			// 					config: 'wireless'
			// 			}, function (result) {
			// 				if (result.result[0] === 0) {
			// 					console.log('Wireless set');
			// 					sendUbusRequest('file', 'exec', {
			// 					command: 'wifimanager',
			// 					params: []
			// 				})
							// } else {
								// console.log('Unable to edit wireless network settings.');
							// }
						// });
					// } else {
						// console.log('Unable to edit wireless network settings.');
					// }
				// });
			// });
	// };

	//Function to generate params and set wireless config
	var setupWifiNetwork = function (ssid, password, auth, uciId) {
		// if (uciId == null) {
		// 	var uciId 			= -1;
		// }
		// var wifiSectionName = '@wifi-iface[' + uciId + ']'
		// setup the wifi-iface
		var params 			= genUciNetworkParams(ssid, password, auth, false, true);
		var wirelessPromise	= addWirelessNetwork(params);
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
			//checkOnlineRequest = null;

			if (data.result[1].code === 0) {
				omegaOnline = true;
			}
			callback(data);
		});
			
	};

	//Displays the list of networks in the dropdown after a scan
	var showScanMessage = function (message) {
		$('#wifi-select').empty();
		$('#wifi-select').append($('<option value="" disabled selected>' + message + '</option>'));
	};

	var showScanMessageModal = function (message) {
		$('#wifi-select-modal').empty();
		$('#wifi-select-modal').append($('<option value="" disabled selected>' + message + '</option>'));
	};

	//Scans for available wlan0 networks using wifi-scan
	var scanWifiNetwork = function () {
		showScanMessage('Scanning...');
		$('#wifi-scan-btn').prop('disabled', true);
		$('#wifi-scan-icon').addClass('rotate');

		sendUbusRequest('onion', 'wifi-scan', {
			device: 'ra0'
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
	
	//Scans for available wlan0 networks using wifi-scan. TODO: Clean up into one function that takes in parameter (id)
	var scanWifiNetworkModal = function () {
		showScanMessageModal('Scanning...');
		$('#wifi-scan-btn-modal').prop('disabled', true);
		$('#wifi-scan-icon-modal').addClass('rotate');

		sendUbusRequest('onion', 'wifi-scan', {
			device: 'ra0'
		}, function (data) {
			$('#wifi-scan-icon-modal').removeClass('rotate');
			$('#wifi-scan-btn-modal').prop('disabled', false);

			if (data && data.error) {
				showScanMessageModal('No Wi-Fi network found');

			} else if (data && data.result) {
				var returnCode = data.result[0];

				if (returnCode === 0 && data.result[1].results.length !== 0) {
					availableWifiNetworks = data.result[1].results;
					
					showScanMessageModal('Choose Wi-Fi Network:');

					for (var i = 0; i < availableWifiNetworks.length; i++) {
						if (availableWifiNetworks[i].ssid) {
							$('#wifi-select-modal').append($('<option value="' + i + '">' + availableWifiNetworks[i].ssid + '</option>'));
						}
					}
				} else {
					showScanMessageModal('No Wi-Fi network found');
				}
			}
		});
	};

	//On click functions for the scan button
	$('#wifi-scan-btn').click(scanWifiNetwork);
	$('#wifi-scan-btn-modal').click(scanWifiNetworkModal);

	//Reads the information of the selected network from the dropdown and displays it in fields for the user
	$('#wifi-select').change(function () {
		var index = $('#wifi-select').val();
		var network = availableWifiNetworks[index];

		$('#wifi-ssid').val(network.ssid);
		$('#wifi-key').val('');

		if (network.encryption === 'NONE') {
			$('#wifi-encryption').val('none');
		} else if (network.encryption.indexOf('WPA2') !== -1) {
			$('#wifi-encryption').val('psk2');
		} else if (network.encryption.indexOf('WPA') !== -1) {
			$('#wifi-encryption').val('psk');
		} else if (network.encryption.indexOf('WEP') !== -1) {
			$('#wifi-encryption').val('wep');
		}
	});
	
	//Reads the information of the selected network from the dropdown and displays it in fields for the user. TODO: Cleanup into one function that takes ID as param modal
	$('#wifi-select-modal').change(function () {
		var index = $('#wifi-select-modal').val();
		var network = availableWifiNetworks[index];

		$('#wifi-ssid-modal').val(network.ssid);
		$('#wifi-key-modal').val('');

		if (network.encryption === 'NONE') {
			$('#wifi-encryption-modal').val('none');
		} else if (network.encryption.indexOf('WPA2') !== -1) {
			$('#wifi-encryption-modal').val('psk2');
		} else if (network.encryption.indexOf('WPA') !== -1) {
			$('#wifi-encryption-modal').val('psk');
		} else if (network.encryption.indexOf('WEP') !== -1) {
			$('#wifi-encryption-modal').val('wep');
		}
	});


	//WiFi form submission function disables buttons to avoid conflicts
	//Then adds the network and enables it
	//Then tests the connection and updates the upgradeRequired variable and others
	$('#wifi-form').submit(function (e) {
		e.preventDefault();
		$('#wifi-message > .alert').alert('close');
		
		var clearFields = function () {
			$('#wifi-ssid').val('');
			$('#wifi-key').val('');
			$('#wifi-encryption').val('None');
		};
		
		var postCheck = function () {
			// clearInterval(animationInterval);
			$('#wifi-config-button').html('Configure Wi-Fi');
			$('#wifi-config-button').prop('disabled', false);
			// $('#skipStepTestButton').prop('disabled', false);
			$('#wifi-loading').css('display','none');
		};

		$('#wifi-config-button').prop('disabled', true);
		// $('#skipStepTestButton').prop('disabled', true);
		$('#wifi-config-button').html('Configuring<div id="wifi-loading" class="wifiLoad" style="display: block;">');

		// var animationInterval = setInterval(function () {
			// var label = $('#wifi-config-button').html();
			// $('#wifi-config-button').html(label.length < 14 ? label + '.' : 'Configuring');
		// }, 1000);
		
		if ($('#wifi-ssid').val() === ''){
			if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessage('danger', 'Please enter an SSID.');
		}else if ($('#wifi-encryption').val() === 'psk2' || $('#wifi-encryption').val() === 'psk'){
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
							
							console.log("Checking for upgrade");
							sendUbusRequest('onion', 'oupgrade', {
								params: {
									check: ''
								}
							}, function (data) {
								binName = data.result[1].image.local;
								upgradeRequired = data.result[1].upgrade;
								fileSize = data.result[1].image.size;
								$('#download-progress').prop('max', data.result[1].image.size);
								postCheck();
								clearFields();
								gotoStep(nextStep);
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
				setupWifiNetwork($('#wifi-ssid').val(), $('#wifi-key').val(), $('#wifi-encryption').val());
			}
	});
	
	$('#wifi-form-modal').submit(function (e) {
		e.preventDefault();
		$('#wifi-message > .alert').alert('close');
		
		var clearFields = function () {
			$('#wifi-ssid-modal').val('');
			$('#wifi-key-modal').val('');
			$('#wifi-encryption-modal').val('None');
		};
		
		var postCheck = function () {
			// clearInterval(animationInterval);
			$('#wifi-config-button-modal').html('Configure Wi-Fi');
			$('#wifi-config-button-modal').prop('disabled', false);
			$('#skipWifiButton').prop('disabled', false);
			$('#wifi-loading').css('display','none');
		};

		$('#wifi-config-button-modal').prop('disabled', true);
		$('#skipWifiButton').prop('disabled', true);
		$('#wifi-config-button-modal').html('Connecting<div id="wifi-loading" class="wifiLoad">');

		// var animationInterval = setInterval(function () {
			// var label = $('#wifi-config-button').html();
			// $('#wifi-config-button').html(label.length < 14 ? label + '.' : 'Configuring');
		// }, 1000);
		
		
		//Checks if the ssid is blank and if the password entered is valid for each encryption type
		if ($('#wifi-ssid-modal').val() === ''){
			if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessageModal('danger', 'Please enter an SSID.');
		}else if ($('#wifi-encryption-modal').val() === 'psk2' || $('#wifi-encryption-modal').val() === 'psk'){
			if($('#wifi-key-modal').val().length < 8 || $('#wifi-key-modal').val().length > 63){
				if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessageModal('danger', 'Please enter a valid password. (WPA and WPA2 passwords are between 8 and 63 characters)');
			}
			
		}else if($('#wifi-encryption-modal').val() === 'wep'){
			if($('#wifi-key-modal').val().length !== 5){
				if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessageModal('danger', 'Please enter a valid password. (WEP passwords are 5 or 13 characters long)');
			}else if($('#wifi-key-modal').val().length !== 13){
				if (checkOnlineRequest) {
					checkOnlineRequest.abort();
					checkOnlineRequest = null;
				}
				postCheck();
				showWifiMessageModal('danger', 'Please enter a valid password. (WEP passwords are 5 or 13 characters long)');
			}
		}
			if(checkOnlineRequest !== null){
				var connectionCheckInterval = setInterval(function () {
					isOnline(function () {
						if (omegaOnline) {
							clearTimeout(connectionCheckTimeout);
							clearInterval(connectionCheckInterval);
							
							console.log("Checking for upgrade");
							sendUbusRequest('onion', 'oupgrade', {
								params: {
									check: ''
								}
							}, function (data) {
								binName = data.result[1].image.local;
								upgradeRequired = data.result[1].upgrade;
								fileSize = data.result[1].image.size;
								$('#download-progress').prop('max', data.result[1].image.size);
								postCheck();
								clearFields();
								$('.modal').modal('hide');
								gotoStep(nextStep);
							});
						// });
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
				var params = genUciNetworkParams($('#wifi-ssid-modal').val(), $('#wifi-key-modal').val(), $('#wifi-encryption-modal').val(), false, false);
				addWirelessNetwork(params);
			}

	});
	
	$('#skipWifiButton').click(function(){
			console.log("skipWifiButton gets called");
			console.log("nextStep in skip TestButton is nextStep",nextStep);
			console.log(preStep);
			gotoStep(nextStep);

	});
	
	// $('#skipStepTestButton').click(function(){
			// console.log("skipWifiButton gets called");
			// console.log("nextStep in skip TestButton is nextStep",nextStep);
			// console.log(preStep);
			// gotoStep(nextStep);

	// });
	
	//Changes the network by disabling the current network, followed by enabling the selected network, and refreshing the network list
	var changeNetwork = function (index, currentIndex, deleteConnectedNetwork, refresh) {

		sendUbusRequest('uci', 'set', {
			config: 'wireless',
			section: savedWifiNetworks[apNetworkIndex][".name"],
			values: {
				ApCliSsid: savedWifiNetworks[index].ssid,
				ApCliAuthMode: savedWifiNetworks[index].encryption,
				ApCliPassWord: savedWifiNetworks[index].key
			}
		}, function(response){
			sendUbusRequest('uci', 'commit', {
					config: 'wireless'
			}, function (response){
				currentNetworkSsid = savedWifiNetworks[index].ssid;
				sendUbusRequest('file', 'exec', {
					command: 'wifi',
					params: []
				}, function(response){
					if(deleteConnectedNetwork){
						deleteNetwork(currentNetworkIndex); //If the currently connected network is to be deleted, delete it and continue
					}
					if(refresh){
						refreshNetworkList(); //Otherwise refresh the network list and continue
					}
					currentNetworkIndex = index;
				});
			});
		});
	};

	//Removes the network at "index"
	var deleteNetwork = function(index) {
		sendUbusRequest('uci', 'delete', {
			config: 'wireless',
			section: savedWifiNetworks[index][".name"]
		}, function(response){
			if(response.result[0] === 0){
				sendUbusRequest('uci', 'commit', {
						config: 'wireless'
				}, function(response){
					refreshNetworkList();
				});
			}
		});
	}
	
	//Refreshes the network list to show most recent network configurations (icons, etc)
	var refreshNetworkList = function () {
		savedWifiNetworks = [];
		$('div').remove('#network-list');
		$('#networkTable').append(" <div class='list-group-item layout horizontal end' id='network-list'></div> ");
		sendUbusRequest('uci','get',{config:"wireless"},function(response){
			$.each( response.result[1].values, function( key, value ) {
				savedWifiNetworks.push(value);
			});
			$.each(savedWifiNetworks, function(key, value) {
				if(value.type === 'ralink')
					return;
				if(value.mode === "ap") {
					apNetworkIndex = value['.index'];
					currentNetworkSsid = value.ApCliSsid;
					$('#network-list').append(" <div class='list-group-item layout horizontal end'><span id='connectedNetwork'class='glyphicons glyphicons-wifi'></span><span>"+ value.ApCliSsid +"</span><div id='" + value['.index'] + "'><a class='glyphicons glyphicons-remove' href='#' data-toggle='tooltip' title='Delete Network'></a></div></div>");
					if (($('#network-list > div').length) <= 1) {
						$('.glyphicons-remove').hide();
					} else {
						$('.glyphicons-remove').show();
					}
					return;
				}
				else {
					if (value.ssid === currentNetworkSsid) {
						currentNetworkIndex = Number(value['.index']);
						return;
					}else{
						$('#network-list').append(" <div class='list-group-item layout horizontal end'><span class='glyphicons glyphicons-wifi'></span><span>"+ value.ssid +"</span><div id='" + value['.index'] + "'><a class='glyphicons glyphicons-remove' href='#' data-toggle='tooltip' title='Delete Network'></a><a class='glyphicons glyphicons-ok' href='#' data-toggle='tooltip' title='Enable Network'></a></div></div> ");
						if (($('#network-list > div').length) <= 1) {
							$('.glyphicons-remove').hide();
						} else {
							$('.glyphicons-remove').show();
						}
						return;
					}
				}
				
			});
		});
		$('#wifi-list').show();
		$('#wifiLoading').hide();
	}
	
	//On click function for the enable network icon (checkmark)
	$('#networkTable').on('click', '.glyphicons-ok', function() {
		$('#wifi-list').hide();
		$('#wifiLoading').show();
		var index = Number($(this).closest('div').prop('id'));
		changeNetwork(index, currentNetworkIndex, false, true); //Enable the selected network and update the network list
	});
	
	
	//On click function for the remove network icon (X)
	$('#networkTable').on('click', '.glyphicons-remove', function() {
		$('#wifi-list').hide();
		$('#wifiLoading').show();
		var index = Number($(this).closest('div').prop('id'));
		if(index === currentNetworkIndex && savedWifiNetworks[index+1]){ //In the case that the deleted network is currently connected and another network is currently configured
			changeNetwork(index+1, currentNetworkIndex, true, true); // Connect to the next network and flag the current network for deletion
		} else {
			deleteNetwork(index);
		}
	});
	

	// ==================
	// Step 3: Cloud Registration
	//===================
	$('#openCloudButton').click(function(){
		// Open the window.
		var win = window.open("https://cloud.onion.io");
	});

	$('#skipCloudReg').click(function(){
		// steps[3].init();
		gotoStep(nextStep);
	});

	$('#setupCloudBackButton').click(function(){
		console.log("preStep",preStep);
		console.log("Back Button from the cloud setup gets called");
		gotoStep(preStep);
	});

	// $(document).on("click","#setupCloudBackButton",function(){
	// 	console.log("preStep",preStep);
	// 	console.log("Back Button from the cloud setup gets called");
	// 	gotoStep(preStep);
	// });

	// var showCloudRegMessage = function (message) {
		// $('#cloudRegMessage').append($('<div id="cloudErrorMsg" class="alert alert-warning alert-dismissible fade in" role="alert"> \
			// <button type="button" class="close" data-dismiss="alert" aria-label="Close"> \
				// <span aria-hidden="true">&times;</span> \
				// <span class="sr-only">Close</span> \
			// </button> \
			// <strong>Error:</strong> ' + message + ' \
		// </div>'));

		// setTimeout(function(){
			// $('#cloudErrorMsg').remove();
		// },15000);
	// };
	
	
	//Get deviceId and Secret from modal window app
	var receiveMessage = function (result) {
		if (result.origin !== "https://registerdevice.onion.io")
		return;
		
		//Checking to see if cloud section exists in config files
		sendUbusRequest('uci', 'get', {
				config:"onion",
				section:"cloud"
			}, function (response) {
				if(response.result.length !== 2){
				sendUbusRequest('uci', 'add', {
					config: 'onion',
					type: 'cloud',
					name: 'cloud'
				}, function () {
					//Setting values in config file to the values from modal window
					sendUbusRequest('uci', 'set', {
						config: 'onion',
						section: 'cloud',
						values: {
							deviceId: result.data.content.deviceId,
							secret: result.data.content.deviceSecret
						}
					}, function (result) {
						console.log('uci set onion.cloud result:', result);
						if (result.result[0] === 0) {
							sendUbusRequest('uci', 'commit', {
									config: 'onion'
							}, function (result) {
								if (result.result[0] === 0) {
									console.log('cloud settings set');
									sendUbusRequest('file', 'exec', {
										command: '/etc/init.d/device-client',
										params: ['restart']
									}, function () {
									$('.modal').modal('hide');
									gotoStep(nextStep);
									});
								} else {
									console.log('Unable to commit cloud settings.');
								}
							});
						} else {
							console.log('Unable to set cloud settings.');
						}
					});
				});
			} else {
				console.log('Cloud settings added')
				sendUbusRequest('uci', 'set', {
					config: 'onion',
					section: 'cloud',
					values: {
						deviceId: result.data.content.deviceId,
						secret: result.data.content.deviceSecret
					}
				}, function (result) {
					console.log('uci set onion.cloud result:', result);
					if (result.result[0] === 0) {
						sendUbusRequest('uci', 'commit', {
								config: 'onion'
						}, function (result) {
							if (result.result[0] === 0) {
								console.log('cloud settings set');
								sendUbusRequest('file', 'exec', {
									command: '/etc/init.d/device-client',
									params: ['restart']
								}, function () {
								$('.modal').modal('hide');
								gotoStep(nextStep);
								});
							} else {
								console.log('Unable to commit cloud settings.');
							}
						});
					} else {
						console.log('Unable to set cloud settings.');
					}
				});
			}
		});
	}
	

	//======================
	// Step 4: Firmware Update
	//======================
	var bFirmwareUpdated = true;

	var bFirmwareDownloaded = true;
		
	var isChecked = true;

	var binName,
		binDownloaded = false,
		upgradeRequired = 'false';

	var checkDownload = function () {
		if (!binDownloaded) {
			var checkDownloadInterval = setInterval(function () {
				sendUbusRequest('file', 'stat', {
					path: binName
				}, function (data) {
					if (data && data.result.length === 2) {
						$('#download-progress').prop('value', data.result[1].size);

						if (data.result[1].size === parseInt(fileSize)) {
							binDownloaded = true;
							clearInterval(checkDownloadInterval);
							console.log('download complete')
							$('#downloading').hide();
							$('#upgrade-required').show();
							startTimer();
							//gotoStep(nextStep);
						}
					}
				});
			}, 1000);
		}
	};
	
	//Updates text on upgrade page based on if upgrade is required or if the console is going to be installed
	var firmwareText = function () {
		if($('#consoleInstall').is(':checked') && upgradeRequired === 'true'){
			$('#upgradeFirmwareButton').html('Upgrade Firmware and Install Console');
			$('#firmwareText').html('<p>Update your Omega to the latest and greatest firmware to get all the newest software goodies from Onion.</p>');
			$('#consoleText').html('<p>The Onion Console is a web-based virtual desktop for the Omega that allows you to easily change settings and can be used as an IDE.</p>');
		} else if($('#consoleInstall').is(':checked') && upgradeRequired === 'false'){
			$('#upgradeFirmwareButton').html('Install Console');
			$('#firmwareText').html('<p>Your Omega is up to date!</p>');
			$('#consoleText').html('<p>The Onion Console is a web-based virtual desktop for the Omega that allows you to easily change settings and can be used as an IDE.</p>');
		} else if(upgradeRequired === 'true'){
			$('#upgradeFirmwareButton').html('Upgrade Firmware');
			$('#firmwareText').html('<p>Update your Omega to the latest and greatest firmware to get all the newest software goodies from Onion.</p>');
			// $('#consoleText').html('');
		} else {
			$('#upgradeFirmwareButton').html('Finish Setup Wizard');
			$('#firmwareText').html('<p>Your Omega is up to date!</p>');
			// $('#consoleText').html('');
		}
	};
	
	$('#consoleInstall').click(firmwareText);
	
	$('#upgradeFirmwareButton').click(function(){
		isChecked = $('#consoleInstall').is(':checked');
		sendUbusRequest('uci', 'set', {
				config: 'onion',
				section: 'console',
				values: {
					setup: '1'
				}
			}, function (result) {
				console.log('uci set onion.console.setup result:', result);
				if (result.result[0] === 0) {
					sendUbusRequest('uci', 'commit', {
							config: 'onion'
					}, function (result) {
						if (result.result[0] === 0) {
							console.log('console setup set');
						} else {
							console.log('Unable to edit console settings.');
						}
					});
				} else {
					console.log('Unable to edit console settings.');
				}
			});
			gotoStep(nextStep);
	});

	$('#skipFirmwareStep').click(function(){
		console.log("Skip Firmware Step Button is clicked");
		upgradeRequired = 'false';
		console.log(upgradeRequired);
		// The last page behaves differently depending on which case was passed in. 
		// Makes sense to add a new case for this.
		gotoStep(nextStep);
	});

	$('#firmwareBackButton').click(function(){
		console.log("firmware back button gets called");
		gotoStep(preStep);
	})


	//=====================
	//Step 5: Setup Complete
	//======================

	$('#completeBackButton').click(function(){
		console.log("complete back button gets called");
		gotoStep(preStep);
	})
	
	function startTimer(){
		var time = 0;
		var timerBar = setInterval(function () {
			time = time + 1;
			
			$('#time').prop('value', time.toString());

			if (time >= 2400) {
				$('#time').hide();
				$('#warning').hide();
				$('#success').show();
				clearInterval(timerBar);
			}
		}, 100);
		
	}

	//======================
	// Steps Management
	//======================

	var currentStep = 0;
	var nextStep;
	var preStep;
	var savedWifiNetworks = [];
	var currentNetworkIndex;

	var steps = [
		{
			ready: function(){
				return false;
			},
			init: function(){
				return;
			}
		},
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
				// return $.sessionStorage.isSet('OmegaToken') && !isTokenExpired();
				return false;
			},
			init: function () {
				$('[data-toggle="tooltip"]').tooltip(); 
				$('#wifi-connect').hide();
				$('#wifi-list').hide();
				$('#wifiLoading').show();
				
				sendUbusRequest('system', 'info', {}, function (data) {
					if (data.result && data.result.length === 2) {
						$('#wifi-ssid').val('');
						$('#wifi-key').val('');
						scanWifiNetwork();
						scanWifiNetworkModal();
					} else {
						gotoStep(preStep);
					}
				});

				
				//Check if already connected to internet. If yes, show configured networks; otherwise, show configure wifi page.
				sendUbusRequest('file', 'exec', {
					command: 'wget',
					params: ['--spider', 'http://repo.onion.io/omega2/images']
				}, function (data){
					if (data.result.length === 2 && data.result[1].code === 0) {
						omegaOnline = true;
						
						refreshNetworkList();
						// $('#wifi-connect').hide();
						// $('#wifiLoading').hide();
						// $('#wifi-list').show();
						// $('#networkTable').show();
						console.log('Already connected to the internet!')
						sendUbusRequest('onion', 'oupgrade', {
							params: {
								check: ''
							}
						}, function (data) {
							binName = data.result[1].image.local;
							upgradeRequired = data.result[1].upgrade;
							fileSize = data.result[1].image.size;
							$('#download-progress').prop('max', data.result[1].image.size);
							$('#wifi-connect').hide();
							$('#wifiLoading').hide();
							$('#wifi-list').show();
							$('#networkTable').show();
						});
					} else {
						sendUbusRequest('file', 'exec', {
							command: 'wget',
							params: ['--spider', 'http://repo.onion.io/omega2/images']
						}, function (data){
							if (data.result.length === 2 && data.result[1].code === 0) {
								omegaOnline = true;
								
								refreshNetworkList();
								// $('#wifi-connect').hide();
								// $('#wifiLoading').hide();
								// $('#wifi-list').show();
								// $('#networkTable').show();
								console.log('Already connected to the internet!')
								sendUbusRequest('onion', 'oupgrade', {
									params: {
										check: ''
									}
								}, function (data) {
									binName = data.result[1].image.local;
									upgradeRequired = data.result[1].upgrade;
									fileSize = data.result[1].image.size;
									$('#download-progress').prop('max', data.result[1].image.size);
									$('#wifi-connect').hide();
									$('#wifiLoading').hide();
									$('#wifi-list').show();
									$('#networkTable').show();
								});
							} else {
								$('#wifiLoading').hide();
								$('#networkTable').hide();
								$('#wifi-connect').show();
							}
						});
					}
				});
				
				//Check to see if you can skip here

				sendUbusRequest('uci','get',{config:"onion",section:"console",option:"setup"},function(response){
					console.log(response);
					// response.result = [0,{}];
					// response.result[1].value = 1;
					// console.log(response);
					if(response.result.length == 2){
						//Got a valid response, cuz the length is two
						if(response.result[1].value == "1"){
							console.log("Skip Buttons should be visible");
							//If value is 1, the setup has been run before and all skip/back buttons except cloud reg are enabled.
							// $('#skipStepTestButton').css('display','block');
							$('#skipWifiButton').css('display','block');
							// $('#skipFirmwareStep').css('display','block');
							// $('#skipCloudReg').css('display','block');
							$('#setupCloudBackButton').css('display','block');
							$('#firmwareBackButton').css('display','block');


							//Fuck it while we are at it, lets add the back buttons here too? Or should we always have back buttons?
						}else{
							console.log("Skip Buttons are hidden");
							//If value is 0, the setup has NOT been run before and all skip buttons are disabled except for cloudSetup one. 
							// $('#skipStepTestButton').css('display','none');
							// $('#skipFirmwareStep').css('display','none');
							// $('#skipCloudReg').css('display','none');
							console.log("About to hide the setupCloudBackButton");
							$('#setupCloudBackButton').css('display','none');
							console.log("Hiding setupCloudBackButton");
							$('#firmwareBackButton').css('display','none');

						}
					} else{
						console.log("Got a wack response from the ubus request, hid all skip buttons");
						//If there is an error, assume it is a first time setup
						// $('#skipStepTestButton').css('display','none');
						// $('#skipFirmwareStep').css('display','none');
						// $('#skipCloudReg').css('display','none');
						console.log("About to hide the setupCloudBackButton");
						$('#setupCloudBackButton').css('display','none');
						console.log("Hiding setupCloudBackButton");
						$('#firmwareBackButton').css('display','none');


					}
				});
			}
		},
		{
			ready: function(){
				console.log("Ready Function for the cloud registration step gets called here");
				return false;
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
				console.log("init function for the cloud registration step gets called here ");
   				$('#cloudLoading').css('display','none');
/*				var devIdFound = false;
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
							$('#setupCloudButton').attr("disabled",true);
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
				},5000); */
				//Run a function to see if the device is setup with the cloud.
				//If it is not, grey out the setupCloud Button and make it not clickable
				//If it is, change its color.
				
				
				sendUbusRequest('uci','get',{config:"onion",section:"cloud"},function(response){
					console.log(response);

					if(response.result.length == 2){
						//If the secret is not anonymous then display the device ID and write change the registerDeviceButton text
						if(response.result[1].values.secret !== "anonymous"){
							$('#cloudText').html('<div class="alert alert-info"><p>Your device is registered with the Onion Cloud. Check out <a href="http://cloud.onion.io/" target="_blank">cloud.onion.io</a> to get started!</p></div>');
							$('#deviceId-list').css('display','block');
							$('#deviceId').html(response.result[1].values.deviceId);
							
							$('#registerDeviceButton').html('Register device again as a new device (not recommended)');
						}
						else {
							$('#deviceId-list').css('display','none');
						}
					}
				});
				
				//Add iframe source on load
				$('#iframe').attr('src','https://registerdevice.onion.io');
				window.addEventListener("message", receiveMessage); //Listening for message from modal

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
				$('#downloading').hide();
				$('#download-complete').hide();
				firmwareText();
			}
		},
		{
			ready: function () {
				return binDownloaded;
			},
			init: function () {
				$('#success').hide();
				
				if (upgradeRequired === 'true' && isChecked) {
					$('#upgrade-not-required').hide();
					$('#install-console-only').hide();
					$('#upgrade-required').hide();
					$('#downloading').show();
					$('#completeBackButton').hide();
					$('#download-progress').prop('value', 0);
					
					sendUbusRequest('uci', 'set', {
					config: 'onion',
					section: 'console',
					values: {
						install: '2' //install = 2 means that the install console package runs on reboot after the firmware update
					}
				}, function (result) {
					console.log('uci set onion.console.setup result:', result);
					if (result.result[0] === 0) {
						sendUbusRequest('uci', 'commit', {
								config: 'onion'
						}, function (result) {
							if (result.result[0] === 0) {
								console.log('console setup set');
							} else {
								console.log('Unable to edit console settings.');
							}
						});
					} else {
						console.log('Unable to edit console settings.');
					}
				});
					
					console.log("Upgrading");
					sendUbusRequest('onion', 'oupgrade', {
						params: {
							force: ''
						}
					});
					
					checkDownload();
				}else if(upgradeRequired === 'true' && !isChecked){
					$('#upgrade-not-required').hide();
					$('#install-console-only').hide();
					$('#upgrade-required').hide();
					$('#downloading').show();
					$('#completeBackButton').hide();
					$('#download-progress').prop('value', 0);
					console.log("Upgrading");
					sendUbusRequest('onion', 'oupgrade', {
						params: {
							force: ''
						}
					});
					
					checkDownload();
				} else {
					binDownloaded = true;
					if(isChecked){
						sendUbusRequest('uci', 'set', {
							config: 'onion',
							section: 'console',
							values: {
								install: '1' //Install = 1 means that no firmware upgrade is required.
							}
						}, function (result) {
							console.log('uci set onion.console.setup result:', result);
							if (result.result[0] === 0) {
								sendUbusRequest('uci', 'commit', {
										config: 'onion'
								}, function (result) {
									if (result.result[0] === 0) {
										console.log('console setup set');
									} else {
										console.log('Unable to edit console settings.');
									}
								});
							} else {
								console.log('Unable to edit console settings.');
							}
						});
						$('#upgrade-required').hide();
						$('#upgrade-not-required').hide();
						$('#downloading').hide();
						$('#install-console-only').show();
						$('#completeBackButton').show();
					} else {
						$('#upgrade-required').hide();
						$('#install-console-only').hide();
						$('#downloading').hide();
						$('#upgrade-not-required').show();
						$('#completeBackButton').show();
					}
				}
			}
		}
	];


	var gotoStep = function (step) {
		if(preStep != step){
			var bSlideLeft = true;
		}
		if (currentStep !== step || ( (currentStep==0) && (step ==0))) {
			currentStep = step;
			preStep = currentStep - 1;
			nextStep = currentStep + 1;

			var indicators = $('#steps-indicator').children(),
				controls = $('#steps').children();

			for (var i = 0; i < indicators.length; i++) {
				if (i <= (step - 1)) {
					$(indicators[i]).addClass('completed');
				} else {
					$(indicators[i]).removeClass('completed');
				}
			}

			steps[step].init();
			console.log("The value of bSlideLeft is:",bSlideLeft);
			if(step == 0){
				$(controls[step]).show();
			} else{
				if(bSlideLeft){
					console.log("Should be going forward");
					// $(controls[step]).hide();
					// $(controls[step]).css('left','700px').show();
					// setTimeout(function(){
					// 	console.log("setTimeout gets called");
					// 	// $(controls[step - 1]).animate({left:'-700px'}).hide();
					// 	$(controls[step - 1]).hide(0,function(){
					// 		$(controls[step]).animate({'left':'0px'});
					// 	});
					// },100);	
					$(controls[step - 1]).show().removeClass('shiftLeftIn').removeClass('shiftLeftOut').removeClass('shiftRightOut').removeClass('shiftRightIn').addClass('shiftLeftOut');
					setTimeout(function(){
						$(controls[step - 1]).hide();
						$(controls[step]).show().removeClass('shiftLeftIn').removeClass('shiftLeftOut').removeClass('shiftRightOut').removeClass('shiftRightIn').addClass('shiftLeftIn').css('height','auto');
					},1000);
					// $(controls[step]).show().removeClass('shiftLeftIn').removeClass('shiftLeftOut').removeClass('shiftRightOut').removeClass('shiftRightIn').addClass('shiftLeftIn').css('height','auto');
					// $(controls[step]).removeClass('shiftLeftOut');
					// $(controls[step]).addClass('shiftLeftIn');

				} else{
					// $(controls[step + 1]).animate({left:'2000px'}).hide("slow",function(){
					// 	$(controls[step]).animate({left:'-2000px'}).show().animate({left:'0px'});
					// });
					// $(controls[step]).css('left','-700px').show();
					// setTimeout(function(){
					// 	// $(controls[step + 1]).animate({left:'700px'}).hide();
					// 	$(controls[step + 1]).hide(0,function(){
					// 		$(controls[step]).animate({'left':'0px'});
					// 	});
					// },100);
					$(controls[step + 1]).show().removeClass('shiftLeftIn').removeClass('shiftLeftOut').removeClass('shiftRightOut').removeClass('shiftRightIn').addClass('shiftRightOut');
					setTimeout(function(){
						$(controls[step + 1]).hide();
						$(controls[step]).show().removeClass('shiftLeftIn').removeClass('shiftLeftOut').removeClass('shiftRightOut').removeClass('shiftRightIn').addClass('shiftRightIn').css('height','auto');

					},1000);
					// $(controls[step]).show().removeClass('shiftLeftIn').removeClass('shiftLeftOut').removeClass('shiftRightOut').removeClass('shiftRightIn').addClass('shiftRightIn').css('height','auto');
					// $(controls[step]).removeClass('shiftRightOut');
					// $(controls[step]).addClass('shiftRightIn');					
				}
			}
			// $(controls).hide();
			// $(controls[step]).show();
		}
	};

	$(function () {
		// Check which step we are in
		console.log("this part of the script gets executed");
		for (var i = 0; i < steps.length; i++) {
			// Test to see if current Step finished
			if (!steps[i].ready()) {
				break;
			}
		}
		console.log(i);

		gotoStep(i);
	});

})();
