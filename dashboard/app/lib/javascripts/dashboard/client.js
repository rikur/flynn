import { createClass, extend } from 'marbles/utils';
import HTTP from 'marbles/http';
import SerializeJSONMiddleware from 'marbles/http/middleware/serialize_json';
import WithCredentialsMiddleware from 'marbles/http/middleware/with_credentials';
import BasicAuthMiddleware from 'marbles/http/middleware/basic_auth';
import QueryParams from 'marbles/query_params';
import Config from './config';
import Dispatcher from './dispatcher';

var Client = createClass({
	displayName: "Client",

	mixins: [{
		ctor: {
			middleware: [
				SerializeJSONMiddleware,
				WithCredentialsMiddleware
			]
		}
	}],

	willInitialize: function (endpoints) {
		this.endpoints = endpoints;
		this.__cachedResponses = {};

		this.__waitForEventFns = [];
		Dispatcher.register(this.__handleEvent.bind(this));
	},

	performRequest: function (method, args) {
		if ( !args.url ) {
			var err = new Error(this.constructor.displayName +".prototype.performRequest(): Can't make request without URL");
			setTimeout(function () {
				throw err;
			}.bind(this), 0);
			return Promise.reject(err);
		}

		var cacheResponse = args.cacheResponse;
		var cachedResponseKey = method + args.url;
		var cachedRepsonses = this.__cachedResponses;
		if (cacheResponse && cachedRepsonses[cachedResponseKey]) {
			return Promise.resolve(cachedRepsonses[cachedResponseKey]);
		}

		var middleware = args.middleware || [];
		delete args.middleware;

		return HTTP(extend({
			method: method,
			middleware: [].concat(this.constructor.middleware).concat(middleware)
		}, args)).then(function (args) {
			var res = args[0];
			var xhr = args[1];
			return new Promise(function (resolve, reject) {
				if (xhr.status >= 200 && xhr.status < 400) {
					if (cacheResponse) {
						cachedRepsonses[cachedResponseKey] = [res, xhr];
					}
					resolve([res, xhr]);
				} else {
					if (xhr.status === 401) {
						Config.fetch();
					}

					reject([res, xhr]);
				}
			});
		});
	},

	performControllerRequest: function (method, args) {
		var controllerKey = (Config.user || {}).controller_key;
		return this.performRequest(method, extend({}, args, {
			middleware: [
				BasicAuthMiddleware("", controllerKey)
			],
			url: this.endpoints.cluster_controller + args.url
		}));
	},

	login: function (token) {
		return this.performRequest('POST', {
			url: this.endpoints.login,
			body: {
				token: token
			},
			headers: {
				'Content-Type': 'application/json'
			}
		}).then(function (args) {
			return Config.fetch().then(function () {
				return args;
			});
		});
	},

	logout: function () {
		return this.performRequest('DELETE', {
			url: this.endpoints.logout
		}).then(function (args) {
			return Config.fetch().then(function () {
				return args;
			});
		});
	},

	ping: function (endpoint, protocol) {
		endpoint = window.location.host.replace("dashboard", endpoint);
		endpoint = protocol + "://" + endpoint + "/ping";

		return this.performRequest('GET', {
			url: endpoint
		});
	},

	getApps: function () {
		return this.performControllerRequest('GET', {
			url: "/apps"
		});
	},

	getApp: function (appId) {
		return this.performControllerRequest('GET', {
			url: "/apps/"+ encodeURIComponent(appId)
		});
	},

	getAppRelease: function (appId) {
		return this.performControllerRequest('GET', {
			url: "/apps/"+ encodeURIComponent(appId) +"/release"
		});
	},

	getAppFormation: function (appId, releaseId) {
		return this.performControllerRequest('GET', {
			url: "/apps/"+ encodeURIComponent(appId) +"/formations/"+ encodeURIComponent(releaseId)
		});
	},

	getAppJobs: function (appId) {
		return this.performControllerRequest('GET', {
			url: "/apps/"+ encodeURIComponent(appId) +"/jobs"
		});
	},

	getAppRoutes: function (appId) {
		return this.performControllerRequest('GET', {
			url: "/apps/"+ encodeURIComponent(appId) +"/routes"
		});
	},

	getAppResources: function (appId) {
		return this.performControllerRequest('GET', {
			url: "/apps/"+ encodeURIComponent(appId) +"/resources"
		});
	},

	createAppRoute: function (appId, data) {
		return this.performControllerRequest('POST', {
			url: "/apps/"+ encodeURIComponent(appId) +"/routes",
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		}).catch(function (args) {
			var xhr = args[1];
			Dispatcher.dispatch({
				name: 'CREATE_APP_ROUTE_FAILED',
				appID: appId,
				routeDomain: data.domain,
				status: xhr.status
			});
		});
	},

	deleteAppRoute: function (appId, routeType, routeId) {
		return this.performControllerRequest('DELETE', {
			url: "/apps/"+ appId +"/routes/"+ routeType +"/"+ routeId
		}).catch(function (args) {
			var xhr = args[1];
			Dispatcher.dispatch({
				name: 'DELETE_APP_ROUTE_FAILED',
				appID: appId,
				routeID: routeId,
				status: xhr.status
			});
		});
	},

	createApp: function (data) {
		return this.performControllerRequest('POST', {
			url: "/apps",
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	updateApp: function (appId, data) {
		return this.performControllerRequest('POST', {
			url: "/apps/"+ encodeURIComponent(appId),
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	deleteApp: function (appId) {
		return this.performControllerRequest('DELETE', {
			url: "/apps/"+ encodeURIComponent(appId)
		});
	},

	createAppDatabase: function (data) {
		return this.performControllerRequest('POST', {
			url: "/providers/postgres/resources",
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	createArtifact: function (data) {
		return this.performControllerRequest('POST', {
			url: "/artifacts",
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	createRelease: function (data) {
		return this.performControllerRequest('POST', {
			url: "/releases",
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	deployAppRelease: function (appID, releaseID) {
		return this.performControllerRequest('POST', {
			url: "/apps/"+ appID +"/deploy",
			body: {id: releaseID},
			headers: {
				'Content-Type': 'application/json'
			}
		}).then(function (args) {
			var res = args[0];
			if (res.finished_at) {
				return args;
			}
			return this.waitForDeployment(appID, res.id).then(function () {
				return args;
			});
		}.bind(this));
	},

	waitForDeployment: function (appID, deploymentID) {
		if ( !window.hasOwnProperty('EventSource') ) {
			return Promise.reject('window.EventSource not defined');
		}

		var controllerKey = (Config.user || {}).controller_key;
		var url = this.endpoints.cluster_controller +'/events';
		url = url + QueryParams.serializeParams([{
			key: controllerKey,
			app_id: appID,
			object_types: 'deployment',
			object_id: deploymentID,
			past: 'true'
		}]);
		return new Promise(function (resolve, reject) {
			var es = new window.EventSource(url, {withCredentials: true});

			setTimeout(function () {
				reject("Timed out waiting for deployment completion");
				es.close();
			}, 10000);

			es.addEventListener("error", function (e) {
				reject(e);
				es.close();
			});
			es.addEventListener("complete", function () {
				resolve();
				es.close();
			});
			es.addEventListener("message", function (e) {
				var res = JSON.parse(e.data);
				if (res.data.status === "complete") {
					resolve();
					es.close();
				}
			});
		}.bind(this));
	},

	openEventStream: function (retryCount) {
		if ( !window.hasOwnProperty('EventSource') ) {
			return Promise.reject('window.EventSource not defined');
		}

		if (this.__eventStream && this.__eventStream.readyState === 1) {
			// Already open
			return Promise.resolve();
		}

		var controllerKey = (Config.user || {}).controller_key;
		var url = this.endpoints.cluster_controller +'/events';
		url = url + QueryParams.serializeParams([{
			key: controllerKey
		}]);
		var open = false;
		var retryTimeout = null;
		var taffyAppID = null;
		var waitForTaffy = new Promise(function (resolve) {
			resolve(this.getApp('taffy').then(function (args) {
				var res = args[0];
				taffyAppID = res.id;
			}));
		}.bind(this));
		return new Promise(function (resolve, reject) {
			var es = new window.EventSource(url, {withCredentials: true});
			this.__eventStream = es;
			var handleError = function (e) {
				if ( !open && (!retryCount || retryCount < 3) ) {
					clearTimeout(retryTimeout);
					retryTimeout = setTimeout(function () {
						this.openEventStream((retryCount || 0) + 1);
					}.bind(this), 300);
				} else {
					reject(e);
				}
			}.bind(this);
			es.addEventListener("open", function () {
				open = true;
			});
			es.addEventListener("error", function (e) {
				es.close();
				handleError(e);
			});
			es.addEventListener("complete", function () {
				resolve();
				es.close();
			});
			es.addEventListener("message", function (e) {
				waitForTaffy.then(function () {
					var res = JSON.parse(e.data);
					if (res.app === taffyAppID) {
						res.taffy = true;
					}
					Dispatcher.handleServerEvent(res);
				});
			});
		}.bind(this));
	},

	getEvents: function (params) {
		return this.performControllerRequest('GET', {
			url: '/events',
			params: [ params ],
			headers: {
				'Accept': 'application/json'
			}
		});
	},

	getEvent: function (eventID) {
		return this.performControllerRequest('GET', {
			url: '/events/'+ encodeURIComponent(eventID)
		});
	},

	createAppRelease: function (appId, data) {
		return this.performControllerRequest('PUT', {
			url: "/apps/"+ appId +"/release",
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	createAppFormation: function (appId, data) {
		return this.performControllerRequest('PUT', {
			url: "/apps/"+ appId +"/formations/"+ data.release,
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	getTaffyRelease: function () {
		return this.performControllerRequest('GET', {
			cacheResponse: true, // response doesn't change
			url: "/apps/taffy/release"
		});
	},

	createTaffyJob: function (data) {
		return this.performControllerRequest('POST', {
			url: "/apps/taffy/jobs",
			body: data,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	},

	__waitForEvent: function (fn) {
		var resolve;
		var promise = new Promise(function (rs) {
			resolve = rs;
		});
		this.__waitForEventFns.push([fn, resolve]);
		return promise;
	},

	__waitForEventWithTimeout: function (fn) {
		return Promise.race([this.__waitForEvent(fn), new Promise(function (resolve, reject) {
			setTimeout(reject, 500);
		})]);
	},

	__handleEvent: function (event) {
		var waitForEventFns = [];
		this.__waitForEventFns.forEach(function (i) {
			if (i[0](event) === true) {
				i[1]();
			} else {
				waitForEventFns.push(i);
			}
		});
		this.__waitForEventFns = waitForEventFns;

		switch (event.name) {
		case 'GET_DEPLOY_APP_JOB':
			// Ensure JOB event fires for app deploy
			// e.g. page reloaded so event won't be coming through the event stream
			this.__waitForEventWithTimeout(function (e) {
				return e.taffy === true && e.name === 'JOB' && (e.data.meta || {}).app === event.appID;
			}).catch(function () {
				return this.getAppJobs('taffy').then(function (args) {
					var res = args[0];
					var job = null;
					for (var i = 0, len = res.length; i < len; i++) {
						if ((res[i].meta || {}).app === event.appID) {
							job = res[i];
							break;
						}
					}
					if (job !== null) {
						Dispatcher.dispatch({
							name: 'JOB',
							taffy: true,
							data: job
						});
					} else {
						return Promise.reject(null);
					}
				});
			}.bind(this));
			break;

		case 'GET_APP_RELEASE':
			this.__waitForEventWithTimeout(function (e) {
				return e.app === event.appID && e.object_type === 'app_release';
			}).catch(function () {
				this.getAppRelease(event.appID).then(function (args) {
					var res = args[0];
					Dispatcher.dispatch({
						name: 'APP_RELEASE',
						app: event.appID,
						object_type: 'app_release',
						object_id: res.id,
						data: {
							release: res
						}
					});
				});
			}.bind(this));
			break;

		case 'GET_APP_FORMATION':
			this.getAppFormation(event.appID, event.releaseID).then(function (args) {
				var res = args[0];
				Dispatcher.dispatch({
					name: 'APP_FORMATION',
					app: event.appID,
					objet_type: 'formation',
					object_id: res.id,
					data: res
				});
			});
			break;

		case 'GET_APP_RESOURCES':
			this.getAppResources(event.appID).then(function (args) {
				var resources = args[0];
				resources.forEach(function (r) {
					Dispatcher.dispatch({
						name: 'RESOURCE',
						app: event.appID,
						object_type: 'resources',
						object_id: r.id,
						data: r
					});
				});
				Dispatcher.dispatch({
					name: 'APP_RESOURCES_FETCHED',
					appID: event.appID
				});
			});
			break;
		}
	}
});

export default Client;
