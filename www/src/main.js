
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

	/* view related functions */
	var view_showHideElement = function (elementId, bShow) {
		var value = 'none';
		if (bShow) {
			value = 'block'
		}
		$(elementId).css('display',value);
	}

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
				$('#loginCard').removeClass('shakeClass')
				setTimeout(function(){
					$('#loginCard').addClass('shakeClass');
				},100);
			} else if (data && data.result) {
				var returnCode = data.result[0];

				if (returnCode === 0) {
					$.sessionStorage.set('OmegaToken', data.result[1].ubus_rpc_session);
					$.sessionStorage.set('OmegaTokenExpires', (new Date()).getTime() + data.result[1].expires * 1000);

					gotoStep(nextStep);
				} else {
					$('#loginButton').prop('disabled', false);
					showLoginMessage('Login failed.');
					$('#loginCard').removeClass('shakeClass')
					setTimeout(function(){
						$('#loginCard').addClass('shakeClass');
					},100);
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

	var wifiParams = {};
	wifiParams['availableWifiNetworks'] = [];
	wifiParams['configuredWifiNetworks'] = [];

	var availableWifiNetworks,
		fileSize = '0',
		omegaOnline = false,
		apNetworkIndex,
		currentNetworkIndex,
		currentNetworkSsid;
	var regularWifiScanElements = {
		messageField: '#wifi-message',
		button: '#wifi-scan-btn',
		icon: '#wifi-scan-icon',
		dropdown: '#wifi-select',
		ssidField: '#wifi-ssid',
		passwordField: '#wifi-key',
		encryptionField: '#wifi-encryption',
		submitButton: '#wifi-config-button'
	};
	var modalWifiScanElements = {
		messageField: '#wifi-message-modal',
		button: '#wifi-scan-btn-modal',
		icon: '#wifi-scan-icon-modal',
		dropdown: '#wifi-select-modal',
		ssidField: '#wifi-ssid-modal',
		passwordField: '#wifi-key-modal',
		encryptionField: '#wifi-encryption',		// LAZAR: seems suspicious
		submitButton: '#wifi-config-button-modal'
	};
	var wifiButtonContent = {
		default: 'Configure WiFi',
		configuring: 'Configuring<div id="wifi-loading" class="wifiLoad" style="display: block;"></div>',
		waiting: 'Configuring<div id="wifi-loading" class="wifiLoad" style="display: block;"></div><div>Waiting for Omega to connect to network</div>'
	};
	var wifiMessageContent = {
		deviceCommunicationError: 'Something went wrong communicating with the device, please try again',
		waitingToConnect: "If you were connected to the Omega's WiFi AP, your computer may disconnect during this process. Please make sure you're still connected!",
		unableToConnect: 'Unable to connect to REPLACE_SSID. Please try again.',
		networkHasNoInternetAccess: 'Omega successfully connected to REPLACE_SSID, but the internet is not accessible. Connect to a network that has internet access!'
	}

	///////////////////////////////////
	/* wifi related device functions */

	// check if device is online
	var device_checkOnline = function(callback) {
		console.log('checking if online...');
		sendUbusRequest('file', 'exec', {
			command: 'wget',
			// params: ['--spider', 'http://repo.onion.io/omega2']
			params: ['--spider', 'http://repo.onion.io/']
		}, function (data){
			if (data.result &&
				typeof (data.result[1]) !== 'undefined' &&
				typeof (data.result[1].code) !== 'undefined' &&
				data.result[1].code === 0
			) {
				callback(true);
			} else {
				callback(false);
			}
		});

	};

	// retrieve list of configured networks from device
	device_getConfiguredNetworks = function (callback) {
		console.log('checking for configured networks');
		sendUbusRequest('onion', 'wifi-setup', {
			command: 'list',
			params: {}
		}, function (resp) {
			if (resp.result && typeof(resp.result[0]) !== 'undefined' && resp.result[0] === 0) {
				callback(null, resp.result[1].results);
			} else {
				callback(true, 'Could not fetch configured network list from the device');
			}
		});
	};

	// perform scan for available Networks
	var device_scanWifi = function (callback) {
		sendUbusRequest('onion', 'wifi-scan', {
			device: 'ra0'
		}, function (data) {
			if (data && data.error) {
				callback(true, 'No Wi-Fi networks found');
			} else if (data && data.result) {
				var returnCode = data.result[0];
				if (returnCode === 0 && data.result[1].results.length !== 0) {
					callback(null, data.result[1].results);
				} else {
					callback(true, 'No Wi-Fi networks found');
				}
			}
		});
	}

	// use wifi-setup to add a configured wifi network
	var device_addWirelessNetwork = function (ssid, auth, password, callback) {
		sendUbusRequest('onion', 'wifi-setup', {
			command: 'add',
			base64: true,
			params: {
				ssid: btoa(ssid),
				password: btoa(password),
				encr: btoa(auth)
			}
		}, function (resp) {
			if (resp.result && typeof(resp.result[0]) !== 'undefined' && resp.result[0] === 0) {
				if (resp.result[1].success) {
					console.log('Successfully added wireless network');
					callback(null, null);
				} else {
					console.log('Unable to add wireless network.');
					callback(true, 'Unable to add wireless network');
				}
			} else {
				console.log('Sending request to add wireless network failed');
				callback(true, 'Sending request to add wireless network failed');
			}
		});
	};

	// use wifi-setup to move a network to the highest priority
	var device_setNetworkHighestPriority = function (ssid, callback) {
		console.log('giving highest priority to network ' + ssid);
		sendUbusRequest('onion', 'wifi-setup', {
			command: 'priority',
			base64: true,
			params: {
				ssid: btoa(ssid),
				move: btoa('top')
			}
		}, function (resp) {
			if (resp.result && typeof(resp.result[0]) !== 'undefined' && resp.result[0] === 0) {
				if (resp.result[1].success) {
					console.log('Successfully updated network priority');
					callback(null, null);
				} else {
					console.log('Unable to change network priority.');
					callback(true, 'Unable to change network priority.');
				}
			} else {
				console.log('Sending request to change wireless network priority failed');
				callback(true, 'Sending request to change wireless network priority failed');
			}
		});
	};

	// use wifi-setup to remove a network configuration
	var device_deleteNetwork = function (ssid, callback) {
		sendUbusRequest('onion', 'wifi-setup', {
			command: 'remove',
			base64: true,
			params: {
				ssid: btoa(ssid)
			}
		}, function (resp) {
			if (resp.result && typeof(resp.result[0]) !== 'undefined' && resp.result[0] === 0) {
				if (resp.result[1].success) {
					console.log('Successfully removed network');
					callback(null, null);
				} else {
					console.log('Unable to remove network.');
					callback(true, 'Unable to remove network.');
				}
			} else {
				console.log('Sending request to remove wireless network configuration failed');
				callback(true, 'Sending request to remove wireless network configuration failed');
			}
		});
	};
	///////////////////////////////////

	/* logic and device interaction functions */
	// scan for wifi networks and populate the dropdown (REGULAR)
	// TODO: separate this by MVC
	var scanWifiNetwork = function (elementData) {
		showScanMessage(elementData.dropdown, 'Scanning...');

		$(elementData.button).prop('disabled', true);
		$(elementData.icon).addClass('rotate');


		device_scanWifi(function (err, data) {
			$(elementData.icon).removeClass('rotate');
			$(elementData.button).prop('disabled', false);

			if (err) {
				showScanMessage(elementData.dropdown, 'No Wi-Fi networks found');
			} else {
				// populate the dropdown with the network results
				showScanMessage(elementData.dropdown, 'Choose Wi-Fi Network:');
				wifiParams.availableWifiNetworks = data;

				for (var i = 0; i < wifiParams.availableWifiNetworks.length; i++) {
					if (wifiParams.availableWifiNetworks[i].ssid) {
						$(elementData.dropdown).append($('<option value="' + i + '">' + wifiParams.availableWifiNetworks[i].ssid + '</option>'));
					}
				}
			}
		});
	};

	// ensure network input parameters are ok
	var checkNetworkConfigInput = function (ssid, encr, password, callback) {
		if (ssid === '') {
			callback(true, 'Please enter an SSID');
		} else if (encr === 'psk2' || encr === 'psk') {
			if (password.length < 8 || password.length > 63) {
				callback(true, 'Please enter a valid password. (WPA and WPA2 passwords are between 8 and 63 characters)')
			} else {
				callback(null,null);
			}
		} else if (encr === 'wep') {
			if (password.length !== 5 && password.length !== 13) {
				callback(true, 'Please enter a valid password. (WEP passwords are 5 or 13 characters long)');
			} else {
				callback(null,null);
			}
		} else {
			callback(null, null);
		}
	};

	// Attempts to connect to a network
	//	after network is added to device, it checks every 3 seconds if there's internet connectivity
	//	if there is no connectivity for 1 minute, it shows a message
	// TODO: separate this by MVC
	var connectToNetwork = function (elementData, ssid, encr, password) {
		clearWifiMessage(elementData);

		wifiSubmitButtonDisable(elementData, wifiButtonContent.configuring);

		// make sure the input parameters are ok
		checkNetworkConfigInput(ssid, encr, password, function (err, msg) {
			if (err) {
				console.error('Error with network input: ', msg);
				// there's an error in the input data
				wifiSubmitButtonEnable(elementData, wifiButtonContent.default);
				// show an alert
				showWifiMessage(elementData, 'danger', msg);
			} else {
				// input data is ok, attempt to add network
				device_addWirelessNetwork(ssid, encr, password, function (err, msg) {
					if (err) {
						// there was an error trying to use ubus to set wireless network
						console.error('Error adding wireless network');
						wifiSubmitButtonEnable(elementData, wifiButtonContent.default);
						showWifiMessage(elementData, 'warning', wifiMessageContent.deviceCommunicationError);
					} else {
						wifiSubmitButtonDisable(elementData, wifiButtonContent.waiting);
						showWifiMessage(elementData, 'warning', wifiMessageContent.waitingToConnect);

						// wireless network set, check to see if the device is online
						console.log('addWirelessNetwork was successful, checking for connectivity');
						var connectionCheckInterval = setInterval(function () {
							device_checkOnline(function(bOnline) {
								if (bOnline) {
									clearTimeout(connectionCheckTimeout);
									clearInterval(connectionCheckInterval);
									console.log('Successfully connected!');

									// TODO: maybe here we should show the network list?
									// advance to the next step
									if (currentStep === stepNames['wifi']) {
										console.log('advancing to next step: ' + nextStep);
										gotoStep(nextStep);
									}
								}
							});
						}, 3000);

						// add a timeout in case it doesn't go online in this time
						var connectionCheckTimeout = setTimeout(function () {
							console.error('Connecting to network timed out');
							clearInterval(connectionCheckInterval);

							// enable the Buttons again
							wifiSubmitButtonEnable(elementData, wifiButtonContent.default);
							// show an alert - based on if connection to network was successful
							device_getConfiguredNetworks(function (err, list) {
								if (err) {
									showWifiMessage(elementData, 'warning', wifiMessageContent.unableToConnect, ssid);
								} else {
									// check if selected SSID is in list and is enabled
									var bSelectedNetworkEnabled = false;
									for (var i = 0; i < list.length; i++) {
										if (list[i].ssid === ssid && list[i].enabled === true) {
											bSelectedNetworkEnabled = true;
											break;
										}
									}
									if (bSelectedNetworkEnabled) {
										// network connection was successful but there is no internet access (otherwise connectionCheckInterval would have gone to the next step)
										showWifiMessage(elementData, 'warning', wifiMessageContent.networkHasNoInternetAccess, ssid);
									} else {
										showWifiMessage(elementData, 'warning', wifiMessageContent.unableToConnect, ssid);
									}
								}
							});

						}, 60000);
					}
				});
			}
		});
	};

	var enableSelectedNetwork = function (ssid, callback) {
		device_setNetworkHighestPriority(ssid, function (err, msg) {
			if (err) {
				console.error(msg);
			}
			refreshNetworkList(function (refreshErr, data) {
				callback(refreshErr, data);
			});
		});
	};

	var removeSelectedNetwork = function (ssid, callback) {
		device_deleteNetwork(ssid, function (err, msg) {
			if (err) {
				console.error(msg);
			}
			refreshNetworkList(function (refreshErr, data) {
				callback(refreshErr, data);
			});
		});
	};

	// retrieve network list from the device, retrying every 3 seconds, with a 30second timeout
	var refreshNetworkList = function (callback) {
		// attempt to retrieve the network list from the device at an interval
		var getNetworkListInterval = setInterval(function () {
			device_getConfiguredNetworks(function(err, list) {
				if (!err) {
					clearTimeout(getNetworkListTimeout);
					clearInterval(getNetworkListInterval);
					callback(null, list);
				}
			});
		}, 3000);

		var getNetworkListTimeout = setTimeout(function () {
			console.error('Grabbing updated configured network list timed out');
			clearInterval(getNetworkListInterval);

			callback(true, 'Retrieving network list from device timed out. Please refresh the page and try again');
		}, 60000);

	};

	/* view manipulation functions */
	//Used to display error messages in an alert box
	var showWifiMessage = function (elementData, type, message, ssid) {
		clearWifiMessage(elementData);
		if (ssid) {
			message = message.replace(/REPLACE_SSID/, ssid);
		}
		$(elementData.messageField).append($('<div class="alert alert-' + type + ' alert-dismissible fade in" role="alert"> \
			<button type="button" class="close" data-dismiss="alert" aria-label="Close"> \
				<span aria-hidden="true">&times;</span> \
				<span class="sr-only">Close</span> \
			</button> \
			' + message + ' \
		</div>'));
	};

	var clearWifiMessage = function (elementData) {
		$(elementData.messageField +' > .alert').alert('close');
	}

	//Displays the list of networks in the dropdown after a scan
	var view_setVisibleWifiElements = function (state) {
		if (state === 'loading') {
			$('#wifiLoading').show();
			$('#wifi-connect').hide();
			$('#wifi-list').hide();
			$('#networkTable').hide();	// is this required?
		} else {
			$('#wifiLoading').hide();
			if (state === 'addNetwork') {
				$('#wifi-connect').show();

				$('#wifi-list').hide();
				$('#networkTable').hide();	// is this required?
			} else if (state === 'addNetworkOption') {
				// just like addNetwork, but showing the cancel button
				view_setVisibleWifiElements('addNetwork');
				$('#wifiCancelButton').show();
			} else if (state === 'networkList') {
				$('#wifi-connect').hide();
				$('#wifi-list').show();
				$('#networkTable').show();
			}
		}
	};

	var showScanMessage = function (element, message) {
		$(element).empty();
		$(element).append($('<option value="" disabled selected>' + message + '</option>'));
	};

	var wifiSubmitButtonDisable = function (elementData, buttonContent) {
		$(elementData.submitButton).prop('disabled', true);
		// $('#skipStepTestButton').prop('disabled', true);
		$(elementData.submitButton).html(buttonContent);
	};

	var wifiSubmitButtonEnable = function (elementData, buttonContent) {
		$(elementData.submitButton).html(buttonContent);
		$(elementData.submitButton).prop('disabled', false);
		// $('#skipStepTestButton').prop('disabled', false);
		$('#wifi-loading').css('display','none');
	}

	// returns network object based on dropdown selection
	var getSelectedNetwork = function (elementData) {
		var index = $(elementData.dropdown).val();
		return (wifiParams.availableWifiNetworks[index])
	};

	// populate network info fields (ssid, password, encryption type)
	var populateNetworkInfo = function (elementData, ssid, password, encr) {
		$(elementData.ssidField).val(ssid);
		$(elementData.passwordField).val('');
		$(elementData.encryptionField).val(encr);
	};

	// clear input fields
	var clearNetworkInfoFields = function (elementData) {
		populateNetworkInfo(elementData, '', '', 'None');
	};

	// populates the network list to show network configurations (with icons, etc)
	var populateNetworkList = function (networkList) {
		if (networkList && Array.isArray(networkList)) {
			$('div').remove('#network-list');
			$('#networkTable').append(" <div class='list-group-item layout horizontal end' id='network-list'></div> ");
			$.each(networkList, function(key, value) {
				var id = '';
				var enableButton = "<a class='glyphicons glyphicons-ok' href='#' data-toggle='tooltip' title='Enable Network'></a>";
				if (value.enabled) {
					id = 'id=\'connectedNetwork\'';
					enableButton = '';
				}
				var html = `<div class='list-group-item layout horizontal end'><span ${id} class='glyphicons glyphicons-wifi'></span><span>${value.ssid}</span><div id='${value.ssid}'><a class='glyphicons glyphicons-remove' href='#' data-toggle='tooltip' title='Delete Network'></a>${enableButton}</div></div>`;
				// console.log('adding to network list:');
				// console.log(html);
				$('#network-list').append(html);

				// if there's only one configured network - do not allow it to be removed
				// lazar@onion.io: there is a use for removing the only network, commenting this out
				// if (($('#network-list > div').length) <= 1) {
				// 	$('.glyphicons-remove').hide();
				// } else {
				// 	$('.glyphicons-remove').show();
				// }
				return;
			});
		}
	};

	var view_showHideSkipWifiButton = function (bShow) {
		var elementId = '#skipWifiButton';
		view_showHideElement(elementId, bShow);
	};

	// handle view changes based on list of configured network
	var view_handleConfiguredNetworkListUpdate = function(list) {
		// TODO: add a check to ensure list is an array
		if (list && list.length > 0) {
			// there are existing configured networks, show the network list
			populateNetworkList(list);
			view_setVisibleWifiElements('networkList');
		} else {
			// no configured networks - show the form to add a network
			view_setVisibleWifiElements('addNetwork');
		}
	};

 	/* event handling functions */
	//On click functions for the scan button
	$('#wifi-scan-btn').click(function () {
		scanWifiNetwork(regularWifiScanElements);
	});

	//Reads the information of the selected network from the dropdown and displays it in fields for the user
	$('#wifi-select').change(function () {
		var networkData = getSelectedNetwork(regularWifiScanElements);
		populateNetworkInfo(regularWifiScanElements, networkData.ssid, '', networkData.encryption);
	});

	$('#wifi-form').submit(function(e) {
		e.preventDefault();
		connectToNetwork(	regularWifiScanElements,
							$('#wifi-ssid').val(),
							$('#wifi-encryption').val(),
							$('#wifi-key').val()
						);
	});

	$('#skipWifiButton').click(function(){
			console.log("skipWifiButton gets called");
			console.log("nextStep in skip TestButton is nextStep",nextStep);
			console.log("previous step is: ", preStep);
			gotoStep(nextStep);

	});

	$('#addWifiButton').click(function(){
			console.log("addWifiButton: enabling wifi-connect");
			view_setVisibleWifiElements('addNetworkOption');
	});

	$('#wifiCancelButton').click(function(){
			console.log("wifiCancelButton: enabling wifi-connect");
			view_setVisibleWifiElements('networkList');
	});

	//On click function for the enable network icon (checkmark)
	$('#networkTable').on('click', '.glyphicons-ok', function() {
		view_setVisibleWifiElements('loading');
		var selectedSsid = String($(this).closest('div').prop('id'));
		console.log('clicked on enable for network ' + selectedSsid);

		enableSelectedNetwork(selectedSsid, function (err, data) {
			if (err) {
				// TODO: come up with a handler here
			} else {
				wifiParams.configuredWifiNetworks = data;
				view_handleConfiguredNetworkListUpdate(data);
			}
		});
	});

	// On click function for the remove network icon (X)
	$('#networkTable').on('click', '.glyphicons-remove', function() {
		view_setVisibleWifiElements('loading');
		var selectedSsid = String($(this).closest('div').prop('id'));
		console.log('clicked on delete for index ' + selectedSsid);

		removeSelectedNetwork(selectedSsid, function (err, data) {
			if (err) {
				// TODO: come up with a handler here
			} else {
				wifiParams.configuredWifiNetworks = data;
				view_handleConfiguredNetworkListUpdate(data);
			}
		});
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
	var receiveDeviceId = function (result) {
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
									window.removeEventListener("message", receiveDeviceId);
									window.addEventListener("message", waitForConnect)
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
								console.log('Waiting for connection...');
								window.removeEventListener("message", receiveDeviceId);
								window.addEventListener("message", waitForConnect);
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

	//Function to go to next step after button in modal is clicked
	var waitForConnect = function(result) {
		if (result.origin !== "https://registerdevice.onion.io")
		return;
		$('#myModal').modal('hide');
		gotoStep(nextStep);
		window.removeEventListener("message", waitForConnect);
		window.addEventListener("message", receiveDeviceId);
	}

	/* view related functions */
	var view_showHideCloudSetupBackButton = function (bShow) {
		var elementId = '#setupCloudBackButton';
		view_showHideElement(elementId, bShow);
	};

	//======================
	// Step 4: Firmware Update
	//======================

	var bFirmwareUpdated = true;

	var bFirmwareDownloaded = true;

	var isChecked = true;

	var binName,
		binDownloaded = false,
		upgradeRequired = 'false';

	var device_checkForUpgrade = function (callback) {
		// CODE TO CHECK FOR NEW FIRMWARE AVAILABILITY:
		console.log("Checking for upgrade");
		sendUbusRequest('onion', 'oupgrade', {
			params: {
				check: ''
			}
		}, function (resp) {
			if (resp.result && typeof(resp.result[0]) !== 'undefined' && resp.result[0] === 0) {
				callback(null, resp.result[1]);
			} else {
				callback(true, 'Invalid response from device');
			}
		});
	}

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

	/* view manipulation functions */
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

	var view_showHideFirmwareBackButton = function (bShow) {
		var elementId = '#firmwareBackButton';
		view_showHideElement(elementId, bShow);
	};

	/* event handling functions */
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

	var checkInstallInterval = null;

	$('#completeBackButton').click(function(){
		console.log("complete back button gets called");
		gotoStep(preStep);
	})

	var checkInstallFunction = function(){
		console.log("Inside checkInstallFunction");

		sendUbusRequest('file', 'exec', {
			command: 'opkg',
			params: ['list-installed']
		}, function (data){
			if (data.error && data.error.code === -32002) {
				clearInterval(checkInstallInterval)
				$('#console-installed').show();
				$('#install-console-only').hide();
			}
		});
	};

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

	var stepNames = {
		"welcome": 0,
		"login": 1,
		"wifi": 2,
		"cloud": 3,
		"software": 4,
		"done": 5
	};

	var steps = [
		{
			// step 0: welcome screen
			ready: function(){
				$('[data-toggle="tooltip"]').tooltip();
				return false;
			},
			init: function(){
				return;
			}
		},
		{
			// step 1: login
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
			// step 2: wifi setup
			ready: function () {
				// return $.sessionStorage.isSet('OmegaToken') && !isTokenExpired();
				return false;
			},
			init: function () {
				view_setVisibleWifiElements('loading');

				sendUbusRequest('system', 'info', {}, function (data) {
					if (data.result && data.result.length === 2) {
						clearNetworkInfoFields(regularWifiScanElements);
						scanWifiNetwork(regularWifiScanElements);
					} else {
						gotoStep(preStep);
					}
				});

				// check if there are already configured networks
				device_getConfiguredNetworks(function(err, list) {
					if (!err) {
						wifiParams.configuredWifiNetworks = list;
						view_handleConfiguredNetworkListUpdate(list);
					} else {
						// no configured networks, show the form to add a network
						console.log('No configured networks found, error value: ', err);
						view_handleConfiguredNetworkListUpdate(null);
					}
				})

				//Check to see if you can skip here
				sendUbusRequest('uci','get',{config:"onion",section:"console",option:"setup"},function(response){
					console.log('uci get onion.console.setup = ', response);
					// response.result = [0,{}];
					// response.result[1].value = 1;
					// console.log(response);
					if(response.result.length == 2){
						//Got a valid response, cuz the length is two
						if(response.result[1].value == "1"){
							// console.log("Skip Buttons should be visible");
							//If value is 1, the setup has been run before and all skip/back buttons except cloud reg are enabled.
							view_showHideSkipWifiButton(true);
							view_showHideCloudSetupBackButton(true);
							view_showHideFirmwareBackButton(true);
						}else{
							// console.log("Skip Buttons are hidden");
							view_showHideSkipWifiButton(false);
							view_showHideCloudSetupBackButton(false);
							view_showHideFirmwareBackButton(false);
						}
					} else{
						// console.log("Got a wack response from the ubus request, hid all skip buttons");
						view_showHideSkipWifiButton(false);
						view_showHideCloudSetupBackButton(false);
						view_showHideFirmwareBackButton(false);
					}
				});
			}
		},
		{
			// step 3: cloud registration
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
					console.log('uci get onion.cloud = ', response);

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
				window.addEventListener("message", receiveDeviceId); //Listening for message from modal

			}

		},
		{
			// step 4: software upgrade
			ready: function () {
				return omegaOnline;
				// return true;
			},
			init: function () {
				$('#softwareLoading').show();
				$('#software-content').hide();

				device_checkForUpgrade(function (err, data) {
					$('#softwareLoading').hide();
					$('#software-content').show();

					if (err) {
						console.error(data);
					} else {
						binName = data.image.local;
						upgradeRequired = data.upgrade;
						fileSize = data.image.size;
						$('#download-progress').prop('max', data.image.size);

						console.log("upgradeRequired",upgradeRequired);
						console.log("binDownloaded",binDownloaded);
						$('#downloading').hide();
						$('#download-complete').hide();

						firmwareText();
					}
				});
			}
		},
		{
			// step 5: done
			ready: function () {
				return binDownloaded;
			},
			init: function () {
				$('#success').hide();

				if (upgradeRequired === 'true' && isChecked) {
					$('#upgrade-not-required').hide();
					$('#install-console-only').hide();
					$('#console-installed').hide();
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
					$('#console-installed').hide();
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
										sendUbusRequest('onion-helper', 'background', {
											command: 'console-install-tool'
										}, function (result) {
											console.log('THE RESULT OF THE INSTALL TOOL: ', result);
											checkInstallInterval = setInterval(function(){
												console.log("this",this)
												checkInstallFunction()
												}.bind(this),10000);
										});
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
						$('#console-installed').hide();
						$('#completeBackButton').show();
					} else {
						$('#upgrade-required').hide();
						$('#install-console-only').hide();
						$('#console-installed').hide();
						$('#downloading').hide();
						$('#upgrade-not-required').show();
						$('#completeBackButton').show();
					}
				}
			}
		}
	];


	var gotoStep = function (step) {
		var bSlideLeft = false;
		if(preStep != step){
			bSlideLeft = true;
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
					console.log("going backwards");
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
		for (var i = 0; i < steps.length; i++) {
			// Test to see if current Step finished
			if (!steps[i].ready()) {
				break;
			}
		}
		console.log('step: ' + i);
		gotoStep(i);
	});

})();
