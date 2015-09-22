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

	// Check to see if the Omega is online!!
	var checkOnlineRequest;
	var isOnline = function (callback) {
		console.log('checking online...');

		if (checkOnlineRequest) {
			checkOnlineRequest.abort();
			checkOnlineRequest = null;
		}

		checkOnlineRequest = sendUbusRequest('onion', 'wifi-setup', {
			params : {
				checkconnection: ''
			}
		}, function (data) {
			checkOnlineRequest = null;

			if (data.result && data.result.length === 2) {
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

					for (let i = 0; i < availableWifiNetworks.length; i++) {
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

		var connectionCheckInterval = setInterval(function () {
			isOnline(function () {
				if (omegaOnline) {
					clearTimeout(connectionCheckTimeout);
					clearInterval(connectionCheckInterval);

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

		sendUbusRequest('onion', 'wifi-setup', {
			params: {
				ssid: $('#wifi-ssid').val(),
				password: $('#wifi-key').val(),
				auth: $('#wifi-encryption').val()
			}
		}, function (data) {
			console.log(data);
		});
	});


	//======================
	// Step 3: Upgrade
	//======================

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
							gotoStep(3);
						}
					}
				});
			}, 1000);
		}
		else {
			// no upgrade download required
			setTimeout(function(){
				gotoStep(3);
			},1000);
		}
	};


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
			}
		},
		{
			ready: function () {
				return omegaOnline;
				// return true;
			},
			init: function () {
				$('#download-progress').prop('value', 0);
				binDownloaded = false;

				if (upgradeRequired === 'true') {
					// Actually start the upgrade!
					console.log("Upgrading");
					sendUbusRequest('onion', 'oupgrade', {
						params: {
							force: ''
						}
					});
				}
				else {
					// No need to upgrade
					console.log("No upgrade required");
					$('#update-download').hide();
					binDownloaded = true;
				}

				checkDownload();
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

			for (let i = 0; i < indicators.length; i++) {
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
