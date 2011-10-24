/* Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to you under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @class
 * @name Impl
 * @memberOf myfaces._impl.core
 * @description Implementation singleton which implements all interface method
 * defined by our jsf.js API
 * */
_MF_SINGLTN(_PFX_CORE+"Impl", _MF_OBJECT,
/**
 * @lends myfaces._impl.core.Impl.prototype
 */
{

    //third option myfaces._impl.xhrCoreAjax which will be the new core impl for now
    _transport      : myfaces._impl.core._Runtime.getGlobalConfig("transport", myfaces._impl.xhrCore._Transports),

    /**
     * external event listener queue!
     */
    _evtListeners   : new (myfaces._impl.core._Runtime.getGlobalConfig("eventListenerQueue", myfaces._impl._util._ListenerQueue))(),

    /**
     * external error listener queue!
     */
    _errListeners   : new (myfaces._impl.core._Runtime.getGlobalConfig("errorListenerQueue", myfaces._impl._util._ListenerQueue))(),

    /*CONSTANTS*/

    /*internal identifiers for options*/
    IDENT_ALL:  "@all",
    IDENT_NONE: "@none",
    IDENT_THIS: "@this",
    IDENT_FORM: "@form",

    /*
     * [STATIC] constants
     */

    P_PARTIAL_SOURCE:   "javax.faces.source",
    P_VIEWSTATE:        "javax.faces.ViewState",
    P_AJAX:             "javax.faces.partial.ajax",
    P_EXECUTE:          "javax.faces.partial.execute",
    P_RENDER:           "javax.faces.partial.render",
    P_EVT:              "javax.faces.partial.event",

    /* message types */
    ERROR: "error",
    EVENT: "event",

    /* event emitting stages */
    BEGIN:      "begin",
    COMPLETE:   "complete",
    SUCCESS:    "success",

    /*ajax errors spec 14.4.2*/
    HTTPERROR:      "httpError",
    EMPTY_RESPONSE: "emptyResponse",
    MALFORMEDXML:   "malformedXML",
    SERVER_ERROR:   "serverError",
    CLIENT_ERROR:   "clientError",
    TIMEOUT_EVENT:  "timeout",


    /*error reporting threshold*/
    _threshold: "ERROR",

    /*blockfilter for the passthrough filtering, the attributes given here
     * will not be transmitted from the options into the passthrough*/
    _BLOCKFILTER: {onerror: true, onevent: true, render: true, execute: true, myfaces: true},



    /**
     * collect and encode data for a given form element (must be of type form)
     * find the javax.faces.ViewState element and encode its value as well!
     * return a concatenated string of the encoded values!
     *
     * @throws Error in case of the given element not being of type form!
     * https://issues.apache.org/jira/browse/MYFACES-2110
     */
    getViewState : function(form) {
        /**
         *  typecheck assert!, we opt for strong typing here
         *  because it makes it easier to detect bugs
         */
        if (form) {
            form = this._Lang.byId(form);
        }

        if (!form
                || !form.nodeName
                || form.nodeName.toLowerCase() != "form") {
            throw new Error(this._Lang.getMessage("ERR_VIEWSTATE"));
        }

        var ajaxUtils = myfaces._impl.xhrCore._AjaxUtils;

        var ret = this._Lang.createFormDataDecorator([]);
        ajaxUtils.encodeSubmittableFields(ret,  form, null);

        return ret.makeFinal();
    },

    /**
     * this function has to send the ajax requests
     *
     * following request conditions must be met:
     * <ul>
     *  <li> the request must be sent asynchronously! </li>
     *  <li> the request must be a POST!!! request </li>
     *  <li> the request url must be the form action attribute </li>
     *  <li> all requests must be queued with a client side request queue to ensure the request ordering!</li>
     * </ul>
     *
     * @param {String|Node} elem any dom element no matter being it html or jsf, from which the event is emitted
     * @param {|Event|} event any javascript event supported by that object
     * @param {|Object|} options  map of options being pushed into the ajax cycle
     *
     *
     * TODO refactoring, the passthrgh handling is only for dragging in request parameters
     * we should rewrite this part
     *
     *
     * a) transformArguments out of the function
     * b) passThrough handling with a map copy with a filter map block map
     */
    request : function(elem, event, options) {

        /*namespace remap for our local function context we mix the entire function namespace into
         *a local function variable so that we do not have to write the entire namespace
         *all the time
         **/
        var _Lang = this._Lang;
        var _Dom =  this._Dom;

        /*assert if the onerror is set and once if it is set it must be of type function*/
        _Lang.assertType(options.onerror, "function");
        /*assert if the onevent is set and once if it is set it must be of type function*/
        _Lang.assertType(options.onevent, "function");

        //options not set we define a default one with nothing
        options = options || {};

		/*preparations for jsf 2.2 windowid handling*/
        //pass the window id into the options if not set already
        if(!options.windowId) {
            var windowId = _Dom.getWindowId();
            (windowId) ? options["javax.faces.windowId"] = windowId: null;
        } else {
            options["javax.faces.windowId"] = options.windowId;
            delete options.windowId;
        }

        /**
         * we cross reference statically hence the mapping here
         * the entire mapping between the functions is stateless
         */
        //null definitely means no event passed down so we skip the ie specific checks
        if ('undefined' == typeof event) {
            event = window.event || null;
        }

        elem = _Dom.byIdOrName(elem);
        var elementId = _Dom.nodeIdOrName(elem);

        /*
         * We make a copy of our options because
         * we should not touch the incoming params!
         */
        var passThrgh = _Lang.mixMaps({}, options, true, this._BLOCKFILTER);

        if (event) {
            passThrgh[this.P_EVT] = event.type;
        }

        /**
         * ajax pass through context with the source
         * onevent and onerror
         */
        var context = {
            source: elem,
            onevent: options.onevent,
            onerror: options.onerror,

            //TODO move the myfaces part into the _mfInternal part
            myfaces: options.myfaces
        };

        /**
         * fetch the parent form
         *
         * note we also add an override possibility here
         * so that people can use dummy forms and work
         * with detached objects
         */
        var form = (options.myfaces && options.myfaces.form)?
                _Lang.byId(options.myfaces.form):
                this._getForm(elem, event);

        /**
         * binding contract the javax.faces.source must be set
         */
        passThrgh[this.P_PARTIAL_SOURCE] = elementId;

        /**
         * javax.faces.partial.ajax must be set to true
         */
        passThrgh[this.P_AJAX] = true;

        if (options.execute) {
            /*the options must be a blank delimited list of strings*/
            /*compliance with Mojarra which automatically adds @this to an execute
             * the spec rev 2.0a however states, if none is issued nothing at all should be sent down
             */
            this._transformList(passThrgh, this.P_EXECUTE, options.execute + " @this", form, elementId);
        } else {
            passThrgh[this.P_EXECUTE] = elementId;
        }

        if (options.render) {
            this._transformList(passThrgh, this.P_RENDER, options.render, form, elementId);
        }

        /**
         * multiple transports upcoming jsf 2.1 feature currently allowed
         * default (no value) xhrQueuedPost
         *
         * xhrQueuedPost
         * xhrPost
         * xhrGet
         * xhrQueuedGet
         * iframePost
         * iframeQueuedPost
         *
         */
        var transportType = this._getTransportType(context, passThrgh, form);

        //additional meta information to speed things up, note internal non jsf
        //pass through options are stored under _mfInternal in the context
        context._mfInternal = {};
        var mfInternal = context._mfInternal;

        mfInternal["_mfSourceFormId"] =     form.id;
        mfInternal["_mfSourceControlId"] =  elementId;
        mfInternal["_mfTransportType"] =    transportType;

        //mojarra compatibility, mojarra is sending the form id as well
        //this is not documented behavior but can be determined by running
        //mojarra under blackbox conditions
        //i assume it does the same as our formId_submit=1 so leaving it out
        //wont hurt but for the sake of compatibility we are going to add it
        passThrgh[form.id] = form.id;

        this._transport[transportType](elem, form, context, passThrgh);

    },

    /**
     * fetches the form in an unprecise manner depending
     * on an element or event target
     *
     * @param elem
     * @param event
     */
    _getForm: function(elem, event) {
        var _Dom =  this._Dom;
        var _Lang = this._Lang;
        var form =  _Dom.fuzzyFormDetection(elem);

        if (!form && event) {
            //in case of no form is given we retry over the issuing event
            form = _Dom.fuzzyFormDetection(_Lang.getEventTarget(event));
            if (!form) {
                throw Error(_Lang.getMessage("ERR_FORM"));
            }
        } else if (!form) {
            throw Error(_Lang.getMessage("ERR_FORM"));
        }
        return form;
    },

    /**
     * determines the transport type to be called
     * for the ajax call
     *
     * @param context the context
     * @param passThrgh  pass through values
     * @param form the form which issues the request
     */
    _getTransportType: function(context, passThrgh, form) {
        /**
         * if execute or render exist
         * we have to pass them down as a blank delimited string representation
         * of an array of ids!
         */
        //for now we turn off the transport auto selection, to enable 2.0 backwards compatibility
        //on protocol level, the file upload only can be turned on if the auto selection is set to true
        var getConfig = myfaces._impl.core._Runtime.getLocalOrGlobalConfig;
        var _Lang     = this._Lang;
        var _Dom      = this._Dom;

        var transportAutoSelection = getConfig(context, "transportAutoSelection", false);
        var isMultipart = (transportAutoSelection && _Dom.getAttribute(form, "enctype") == "multipart/form-data") ?
                _Dom.isMultipartCandidate(passThrgh[this.P_EXECUTE]) :
                false;

        /**
         * multiple transports upcoming jsf 2.1 feature currently allowed
         * default (no value) xhrQueuedPost
         *
         * xhrQueuedPost
         * xhrPost
         * xhrGet
         * xhrQueuedGet
         * iframePost
         * iframeQueuedPost
         *
         */
        var transportType = (!isMultipart) ?
                getConfig(context, "transportType", "xhrQueuedPost") :
                getConfig(context, "transportType", "multipartQueuedPost");
        if (!this._transport[transportType]) {
            //throw new Error("Transport type " + transportType + " does not exist");
            throw new Error(_Lang.getMessage("ERR_TRANSPORT",null, transportType));
        }
        return transportType;

    },

    /**
     * transforms the list to the expected one
     * with the proper none all form and this handling
     * (note we also could use a simple string replace but then
     * we would have had double entries under some circumstances)
     *
     * @param passThrgh
     * @param target
     * @param srcStr
     * @param form
     * @param elementId
     */
    _transformList: function(passThrgh, target, srcStr, form, elementId) {
        var _Lang = this._Lang;
        //this is probably the fastest transformation method
        //it uses an array and an index to position all elements correctly
        //the offset variable is there to prevent 0 which results in a javascript
        //false
        var offset = 1,
                vals  = (srcStr) ? srcStr.split(/\s+/) : [],
                idIdx = (vals.length) ? _Lang.arrToMap(vals, offset) : {},

                //helpers to improve speed and compression
                none    = idIdx[this.IDENT_NONE],
                all     = idIdx[this.IDENT_ALL],
                theThis = idIdx[this.IDENT_THIS],
                theForm = idIdx[this.IDENT_FORM];

        if (none) {
            //in case of none only one value is returned
            passThrgh[target] = this.IDENT_NONE;
            return passThrgh;
        }
        if (all) {
            //in case of all only one value is returned
            passThrgh[target] = this.IDENT_ALL;
            return passThrgh;
        }

        if (theForm) {
            //the form is replaced with the proper id but the other
            //values are not touched
            vals[theForm - offset] = form.id;
        }
        if (theThis && !idIdx[elementId]) {
            //in case of this, the element id is set
            vals[theThis - offset] = elementId;
        }

        //the final list must be blank separated
        passThrgh[target] = vals.join(" ");
        return passThrgh;
    },

    addOnError : function(/*function*/errorListener) {
        /*error handling already done in the assert of the queue*/
        this._errListeners.enqueue(errorListener);
    },

    addOnEvent : function(/*function*/eventListener) {
        /*error handling already done in the assert of the queue*/
        this._evtListeners.enqueue(eventListener);
    },



    /**
     * implementation triggering the error chain
     *
     * @param {Object} request the request object which comes from the xhr cycle
     * @param {Object} context (Map) the context object being pushed over the xhr cycle keeping additional metadata
     * @param {String} name the error name
     * @param {String} serverErrorName the server error name in case of a server error
     * @param {String} serverErrorMessage the server error message in case of a server error
     *
     *  handles the errors, in case of an onError exists within the context the onError is called as local error handler
     *  the registered error handlers in the queue receiv an error message to be dealt with
     *  and if the projectStage is at development an alert box is displayed
     *
     *  note: we have additional functionality here, via the global config myfaces.config.defaultErrorOutput a function can be provided
     *  which changes the default output behavior from alert to something else
     *
     *
     */
    sendError : function sendError(/*Object*/request, /*Object*/ context, /*String*/ name, /*String*/ serverErrorName, /*String*/ serverErrorMessage) {
        var _Lang = myfaces._impl._util._Lang;
        var UNKNOWN = _Lang.getMessage("UNKNOWN");

        var eventData = {};
        //we keep this in a closure because we might reuse it for our serverErrorMessage
        var malFormedMessage = function() {
            return (name && name === myfaces._impl.core.Impl.MALFORMEDXML) ? _Lang.getMessage("ERR_MALFORMEDXML") : "";
        };



        //by setting unknown values to unknown we can handle cases
        //better where a simulated context is pushed into the system
        eventData.type = this.ERROR;

        eventData.status            = name || UNKNOWN;
        eventData.serverErrorName   = serverErrorName || UNKNOWN;
        eventData.serverErrorMessage =  serverErrorMessage || UNKNOWN;

        try {
            eventData.source        = context.source || UNKNOWN;
            eventData.responseCode  = request.status || UNKNOWN;
            eventData.responseText  = request.responseText  || UNKNOWN;
            eventData.responseXML   = request.responseXML || UNKNOWN;
        } catch (e) {
            // silently ignore: user can find out by examining the event data
        }

        /**/
        if (context["onerror"]) {
            context.onerror(eventData);
        }

        /*now we serve the queue as well*/
        this._errListeners.broadcastEvent(eventData);

        if (jsf.getProjectStage() === "Development" && this._errListeners.length() == 0) {
            var defaultErrorOutput = myfaces._impl.core._Runtime.getGlobalConfig("defaultErrorOutput", alert);
            var finalMessage = [];

            finalMessage.push((name) ? name : "");
            if (name)
            {
                finalMessage.push(": ");
            }
            finalMessage.push((serverErrorName) ? serverErrorName : "");
            if (serverErrorName)
            {
                finalMessage.push(" ");
            }
            finalMessage.push((serverErrorMessage) ? serverErrorMessage : "");
            finalMessage.push(malFormedMessage());
            finalMessage.push("\n\n");
            finalMessage.push( _Lang.getMessage("MSG_DEV_MODE"));
            defaultErrorOutput(finalMessage.join(""));
        }
    },

    /**
     * sends an event
     */
    sendEvent : function sendEvent(/*Object*/request, /*Object*/ context, /*event name*/ name) {
        var _Lang = myfaces._impl._util._Lang;
        var eventData = {};
        var UNKNOWN = _Lang.getMessage("UNKNOWN");

        eventData.type = this.EVENT;

        eventData.status = name;
        eventData.source = context.source;


        if (name !== this.BEGIN) {

            try {
                //we bypass a problem with ie here, ie throws an exception if no status is given on the xhr object instead of just passing a value
                var getValue = function(value, key) {
                    try {
                        return value[key]
                    } catch (e) {
                        return UNKNOWN;
                    }
                };

                eventData.responseCode = getValue(request, "status");
                eventData.responseText = getValue(request, "responseText");
                eventData.responseXML  = getValue(request, "responseXML");

            } catch (e) {
                var impl = myfaces._impl.core._Runtime.getGlobalConfig("jsfAjaxImpl", myfaces._impl.core.Impl);
                impl.sendError(request, context, this.CLIENT_ERROR, "ErrorRetrievingResponse",
                        _Lang.getMessage("ERR_CONSTRUCT", e.toString()));

                //client errors are not swallowed
                throw e;
            }

        }

        /**/
        if (context.onevent) {
            /*calling null to preserve the original scope*/
            context.onevent.call(null, eventData);
        }

        /*now we serve the queue as well*/
        this._evtListeners.broadcastEvent(eventData);
    },

    /**
     * processes the ajax response if the ajax request completes successfully
     * this is the case for non queued outside calls which are triggered by calling response
     * themselves and hence the case according to the spec
     *
     * @param {Object} request (xhrRequest) the ajax request!
     * @param {Object} context (Map) context map keeping context data not being passed down over
     * the request boundary but kept on the client
     */
    response : function(request, context) {
        this._transport.response(request, context);
    },

    /**
     * @return the project stage also emitted by the server:
     * it cannot be cached and must be delivered over the server
     * The value for it comes from the request parameter of the jsf.js script called "stage".
     */
    getProjectStage : function() {
        //since impl is a singleton we only have to do it once at first access
        if(!this._projectStage) {
            var PRJ_STAGE = "projectStage";
            var STG_PROD ="Production";

            var scriptTags = document.getElementsByTagName("script");
            var getConfig  = myfaces._impl.core._Runtime.getGlobalConfig;
            var projectStage = null;
            var found = false;
            var allowedProjectStages = {STG_PROD:1,"Development":1, "SystemTest":1,"UnitTest":1};

             /* run through all script tags and try to find the one that includes jsf.js */
            for (var i = 0; i < scriptTags.length && !found; i++) {
                if (scriptTags[i].src.search(/\/javax\.faces\.resource\/jsf\.js.*ln=javax\.faces/) != -1) {
                    var result = scriptTags[i].src.match(/stage=([^&;]*)/);
                    found = true;
                    if (result) {
                        // we found stage=XXX
                        // return only valid values of ProjectStage
                        projectStage = (allowedProjectStages[result[1]]) ? result[1] : null;
                    }
                    else {
                        //we found the script, but there was no stage parameter -- Production
                        //(we also add an override here for testing purposes, the default, however is Production)
                        projectStage = getConfig(PRJ_STAGE, STG_PROD);
                    }
                }
            }
            /* we could not find anything valid --> return the default value */
            this._projectStage = projectStage || getConfig(PRJ_STAGE, STG_PROD);
        }
        return this._projectStage;
    },

    /**
     * implementation of the external chain function
     * moved into the impl
     *
     *  @param {Object} source the source which also becomes
     * the scope for the calling function (unspecified side behavior)
     * the spec states here that the source can be any arbitrary code block.
     * Which means it either is a javascript function directly passed or a code block
     * which has to be evaluated separately.
     *
     * After revisiting the code additional testing against components showed that
     * the this parameter is only targeted at the component triggering the eval
     * (event) if a string code block is passed. This is behavior we have to resemble
     * in our function here as well, I guess.
     *
     * @param {Event} event the event object being passed down into the the chain as event origin
     *   the spec is contradicting here, it on one hand defines event, and on the other
     *   it says it is optional, after asking, it meant that event must be passed down
     *   but can be undefined
     */
    chain : function(source, event) {
        var len   = arguments.length;
        var _Lang = this._Lang;

        //the spec is contradicting here, it on one hand defines event, and on the other
        //it says it is optional, I have cleared this up now
        //the spec meant the param must be passed down, but can be 'undefined'
        if (len < 2) {
            throw new Error(_Lang.getMessage("ERR_EV_OR_UNKNOWN"));
        } else if (len < 3) {
            if ('function' == typeof event || this._Lang.isString(event)) {

                throw new Error(_Lang.getMessage("ERR_EVT_PASS"));
            }
            //nothing to be done here, move along
            return true;
        }
        //now we fetch from what is given from the parameter list
        //we cannot work with splice here in any performant way so we do it the hard way
        //arguments only are give if not set to undefined even null values!

        //assertions source either null or set as dom element:

        if ('undefined' == typeof source) {
            throw new Error(_Lang.getMessage("ERR_SOURCE_DEF_NULL"));
            //allowed chain datatypes
        } else if ('function' == typeof source) {
            throw new Error(_Lang.getMessage("ERR_SOURCE_FUNC"));
        }
        if (this._Lang.isString(source)) {
            throw new Error(_Lang.getMessage("ERR_SOURCE_NOSTR"));
        }

        //assertion if event is a function or a string we already are in our function elements
        //since event either is undefined, null or a valid event object

        if ('function' == typeof event || this._Lang.isString(event)) {
            throw new Error(_Lang.getMessage("ERR_EV_OR_UNKNOWN"));
        }

        for (var cnt = 2; cnt < len; cnt++) {
            //we do not change the scope of the incoming functions
            //but we reuse the argument array capabilities of apply
            var ret;

            if ('function' == typeof arguments[cnt]) {
                ret = arguments[cnt].call(source, event);
            } else {
                //either a function or a string can be passed in case of a string we have to wrap it into another function
                ret = new Function("event", arguments[cnt]).call(source, event);
            }
            //now if one function returns false in between we stop the execution of the cycle
            //here, note we do a strong comparison here to avoid constructs like 'false' or null triggering
            if (ret === false /*undefined check implicitly done here by using a strong compare*/) {
                return false;
            }
        }
        return true;

    },

    /**
     * error handler behavior called internally
     * and only into the impl it takes care of the
     * internal message transformation to a myfaces internal error
     * and then uses the standard send error mechanisms
     * also a double error logging prevention is done as well
     *
     * @param request the request currently being processed
     * @param context the context affected by this error
     * @param sourceClass the sourceclass throwing the error
     * @param func the function throwing the error
     * @param exception the exception being thrown
     */
     stdErrorHandler: function(request, context, sourceClass, func, exception) {

        var _Lang = myfaces._impl._util._Lang;
        var exProcessed = _Lang.isExceptionProcessed(exception);
        try {
            //newer browsers do not allow to hold additional values on native objects like exceptions
            //we hence capsule it into the request, which is gced automatically
            //on ie as well, since the stdErrorHandler usually is called between requests
            //this is a valid approach

            if (this._threshold == "ERROR" && !exProcessed) {
                this.sendError(request, context, this.CLIENT_ERROR, exception.name,
                        "MyFaces ERROR:" + this._Lang.createErrorMsg(sourceClass, func, exception));
            }
        } finally {

            //we forward the exception, just in case so that the client
            //will receive it in any way
            try {
                if (!exProcessed) {
                    _Lang.setExceptionProcessed(exception);
                }
            } catch(e) {

            }
            throw exception;
        }
    }
});

