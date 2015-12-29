/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
MediaPlayer.dependencies.TextSourceBuffer = function () {
    var allTracksAreDisabled = false,
        parser = null,
        embeddedCcTracks = [],
        embeddedCcTimescale = 0,
        embeddedSegmentNumbers = [],
        cea608FieldParsers = [null, null],
        cea608LastSegNr = null,
        currentFragmentedTrackIdx = null,

        setTextTrack = function() {
            var el = this.videoModel.getElement(),
                tracks = el.textTracks,
                ln = tracks.length,
                self = this,
                oldTrackIdx = self.textTrackExtensions.getCurrentTrackIdx(),
                nrNonEmbeddedTracks = ln - embeddedCcTracks.length;

            for (var i = 0; i < ln; i++ ) {
                var track = tracks[i];
                allTracksAreDisabled = track.mode !== "showing";
                if (track.mode === "showing") {
                    if (oldTrackIdx !== i) { // do not reset track if already the current track.  This happens when all captions get turned off via UI and then turned on again and with videojs.
                        self.textTrackExtensions.setCurrentTrackIdx(i);
                        self.textTrackExtensions.addCaptions(i, 0, null); // Make sure that previously queued captions are added as cues.
                        if (self.isFragmented) {
                            if (i <  nrNonEmbeddedTracks) {
                                var currentFragTrack = self.mediaController.getCurrentTrackFor("fragmentedText", this.streamController.getActiveStreamInfo());
                                var newFragTrack = self.fragmentedTracks[i];
                                if (newFragTrack !== currentFragTrack) {
                                    self.fragmentModel.cancelPendingRequests();
                                    self.fragmentModel.abortRequests();
                                    //self.buffered.clear()
                                    self.mediaController.setTrack(newFragTrack);
                                    currentFragmentedTrackIdx = i;
                                }
                            }
                        }
                    }
                    break;
                }
            }

            if (allTracksAreDisabled){
                self.textTrackExtensions.setCurrentTrackIdx(-1);
            }
        };

    return {
        system:undefined,
        videoModel: undefined,
        errHandler: undefined,
        adapter: undefined,
        manifestExt:undefined,
        mediaController:undefined,
        streamController:undefined,
        fragmentExt:undefined,
        textTrackExtensions:undefined,
        boxParser: undefined,

        initialize: function (type, bufferController) {
            this.sp = bufferController.streamProcessor;
            this.mediaInfos = this.sp.getMediaInfoArr();
            this.isFragmented = !this.manifestExt.getIsTextTrack(type);
            if (this.isFragmented){
                this.fragmentModel = this.sp.getFragmentModel();
                this.buffered =  this.system.getObject("customTimeRanges");
                this.initializationSegmentReceived= false;
                this.timescale= 90000;
                this.fragmentedTracks = this.mediaController.getTracksFor("fragmentedText", this.streamController.getActiveStreamInfo());
                var currFragTrack = this.mediaController.getCurrentTrackFor("fragmentedText", this.streamController.getActiveStreamInfo());
                for (var i = 0 ; i < this.fragmentedTracks.length; i++) {
                    if (this.fragmentedTracks[i] === currFragTrack) {
                        currentFragmentedTrackIdx = i;
                        break;
                    }
                }
            }
        },

        append: function (bytes, chunk) {
            var self = this,
                result,
                samplesInfo,
                sampleList,
                i,
                trackIdx,
                ccContent,
                mediaInfo = chunk.mediaInfo,
                mediaType = mediaInfo.type,
                mimeType = mediaInfo.mimeType;

            function createTextTrackFromMediaInfo(captionData, mediaInfo) {
                var textTrackInfo = new MediaPlayer.vo.TextTrackInfo(),
                    totalNrTracks = null,
                    trackKindMap = {subtitle:"subtitles", caption:"captions"},//Dash Spec has no "s" on end of KIND but HTML needs plural.
                    getKind = function () {
                        var kind = (mediaInfo.roles.length > 0) ? trackKindMap[mediaInfo.roles[0]] : trackKindMap.caption;
                        kind = (kind === trackKindMap.caption || kind === trackKindMap.subtitle) ? kind : trackKindMap.caption;
                        return kind;
                    },
                    
                    checkTTML = function () {
                        var ttml = false;
                        if (mediaInfo.codec && mediaInfo.codec.search("stpp") >= 0) {
                            ttml = true;
                        }
                        if (mediaInfo.mimeType && mediaInfo.mimeType.search("ttml") >= 0) {
                            ttml = true;
                        }
                        return ttml;
                    };

                textTrackInfo.captionData = captionData;
                textTrackInfo.lang = mediaInfo.lang;
                textTrackInfo.label = mediaInfo.id; // AdaptationSet id (an unsigned int)
                textTrackInfo.index = mediaInfo.index; // AdaptationSet index in manifest
                textTrackInfo.isTTML = checkTTML();
                textTrackInfo.isCEA608 = mediaInfo.isEmbedded;
                textTrackInfo.video = self.videoModel.getElement();
                textTrackInfo.defaultTrack = self.getIsDefault(mediaInfo);
                textTrackInfo.isFragmented = self.isFragmented;
                textTrackInfo.kind = getKind();
                textTrackInfo.isEmbedded = mediaInfo.isEmbedded !== null;
                totalNrTracks = (self.mediaInfos ? self.mediaInfos.length : 0) + embeddedCcTracks.length;
                
                self.textTrackExtensions.addTextTrack(textTrackInfo, totalNrTracks);
            }

            if(mediaType === "fragmentedText"){
                if(!this.initializationSegmentReceived){
                    this.initializationSegmentReceived=true;
                    for (i = 0; i < this.mediaInfos.length; i++){
                        createTextTrackFromMediaInfo(null, this.mediaInfos[i]);
                    }
                    this.timescale = this.fragmentExt.getMediaTimescaleFromMoov(bytes);
                } else {
                    trackIdx = currentFragmentedTrackIdx;
                    samplesInfo = this.fragmentExt.getSamplesInfo(bytes);
                    sampleList = samplesInfo.sampleList;
                    for(i= 0 ; i < sampleList.length ; i++) {
                        if(!this.firstSubtitleStart){
                            this.firstSubtitleStart = sampleList[0].cts-chunk.start*this.timescale;
                        }
                        sampleList[i].cts -= this.firstSubtitleStart;
                        this.buffered.add(sampleList[i].cts/this.timescale,(sampleList[i].cts+sampleList[i].duration)/this.timescale);
                        ccContent = window.UTF8.decode(new Uint8Array(bytes.slice(sampleList[i].offset,sampleList[i].offset+sampleList[i].size)));
                        parser = parser !== null ? parser : self.getParser(mimeType);
                        try{
                            result = parser.parse(ccContent);
                            this.textTrackExtensions.addCaptions(trackIdx, this.firstSubtitleStart/this.timescale,result);
                        } catch(e) {
                            console.warning("TTML parsing issue: " + e);
                            //Could be empty cue, but also something more severe
                        }
                    }
                }
            } else if (mediaType === "video") {
                if (chunk.segmentType === "Initialization Segment") {
                    if (embeddedCcTimescale === 0) {
                        embeddedCcTimescale = this.fragmentExt.getMediaTimescaleFromMoov(bytes);
                        for (i = 0 ; i < embeddedCcTracks.length ; i++) {
                            createTextTrackFromMediaInfo(null, embeddedCcTracks[i]);
                        }
                    }
                } else {
                    
                    // Here we need to check if tracks are setup and make functions that bind
                    // addCaptions to various embedded tracks.
                   
                   var makeCueAdderForIndex = function(self, trackIndex) {
                        function newCue(startTime, endTime, captionScreen) {
                            var captionsArray = null;
                            if (self.videoModel.getTTMLRenderingDiv()) {
                                captionsArray = createHTMLCaptionsFromScreen(self.videoModel.getElement(), startTime, endTime, captionScreen);
                            } else {
                                var text = captionScreen.getDisplayText();
                                //console.log("CEA text: " + startTime + "-" + endTime + "  '" + text + "'");
                                captionsArray = [{start : startTime, end : endTime, data : text, styles : {}}];
                            }
                            if (captionsArray) {
                                self.textTrackExtensions.addCaptions(trackIndex, 0, captionsArray);
                            }
                        }
                        return newCue;
                   };

                    if (embeddedCcTimescale === 0) {
                        console.log("CEA-608: No timescale for embeddedTextTrack yet");
                        return;
                    }
                    if (!cea608FieldParsers[0] && !cea608FieldParsers[1]) {
                        // Time to setup the CEA-608 parsing
                        var field, handler;
                        for ( i = 0 ; i < embeddedCcTracks.length ; i++) {
                            if (embeddedCcTracks[i].id === "CC1") {
                                field = 0;
                                trackIdx = this.textTrackExtensions.getTrackIdxForId("CC1");
                            } else if (embeddedCcTracks[i].id === "CC3") {
                                field = 1;
                                trackIdx = this.textTrackExtensions.getTrackIdxForId("CC3");
                            }
                            if (trackIdx === -1) {
                                console.log("CEA-608: data before track is ready.");
                                return;
                            }
                            handler = makeCueAdderForIndex(this, trackIdx);
                            cea608FieldParsers[i] = new cea608parser.Cea608Parser(i, {'newCue' : handler}, null);
                        }
                    }
                 
                    
                    samplesInfo = this.fragmentExt.getSamplesInfo(bytes);
                    var sequenceNumber = samplesInfo.sequenceNumber;
                    //console.log("CEA-608 sequence number: " + sequenceNumber);

                    var captionId = 0;
                    var createHTMLCaptionsFromScreen = function(vm, startTime, endTime, cs) {

                        function checkIndent(chars) {
                            var line = '';

                            for (var c=0; c < chars.length; ++c) {
                                var uc = chars[c];
                                line += uc.uchar;
                            }

                            var l = line.length;
                            var ll = line.replace(/^\s+/,"").length;
                            return l-ll;
                        }

                        function getRegionProperties(region) {
                            return "left: " + (region.x * 3.125) + "%; top: " + (region.y1 * 6.66) + "%; width: " + (100 - (region.x * 3.125)) + "%; height: " + (Math.max((region.y2 - 1) - region.y1, 1) * 6.66) + "%; align-items: flex-start; overflow: visible; -webkit-writing-mode: horizontal-tb;";
                        }

                        function createRGB(color) {
                            if (color == "red") {
                                return "rgb(255, 0, 0)";
                            } else if (color == "green") {
                                return "rgb(0, 255, 0)";
                            } else if (color == "blue") {
                                return "rgb(0, 0, 255)";
                            } else if (color == "cyan") {
                                return "rgb(0, 255, 255)";
                            } else if (color == "magenta") {
                                return "rgb(255, 0, 255)";
                            } else if (color == "yellow") {
                                return "rgb(255, 255, 0)";
                            } else if (color == "white") {
                                return "rgb(255, 255, 255)";
                            } else if (color == "black") {
                                return "rgb(0, 0, 0)";
                            }
                            return color;
                        }

                        function getStyle(style) {
                            var fontSize = vm.videoHeight / 15.0;
                            if (style) {
                                return "font-size: " + fontSize + "px; font-family: Menlo, Consolas, 'Cutive Mono', monospace; color: " + ((style.foreground) ? createRGB(style.foreground) : "rgb(255, 255, 255)") + "; font-style: " + (style.italics ? "italic" : "normal") + "; text-decoration: " + (style.underline ? "underline" : "none") + "; white-space: pre; background-color: " + ((style.background) ? createRGB(style.background) : "trasparent") + ";";
                            } else {
                                return "font-size: " + fontSize + "px; font-family: Menlo, Consolas, 'Cutive Mono', monospace; justify-content: flex-start; text-align: left; color: rgb(255, 255, 255); font-style: normal; white-space: pre; line-height: normal; font-weight: normal; text-decoration: none; width: 100%; display: flex;";
                            }
                        }
                    
                        function ltrim(s) {
                            var trimmed = s.replace(/^\s+/g, '');
                            return trimmed;
                        }
                        function rtrim(s) {
                            var trimmed = s.replace(/\s+$/g, '');
                            return trimmed;
                        }

                        var currRegion = null;
                        var existingRegion = null;
                        var lastRowHasText = false;
                        var lastRowIndentL = -1;
                        var currP = { start:startTime, end:endTime, spans:[] };
                        var currentStyle = "style_cea608_white_black";
                        var seenRegions = { };
                        var styleStates = { };
                        var regions = [];
                        var r, s;

                        for (r = 0; r < 15; ++r) {
                            var row = cs.rows[r];
                            var line = '';
                            var prevPenState = null;

                            if (false === row.isEmpty()) {
                                /* Row is not empty */

                                /* Get indentation of this row */
                                var rowIndent = checkIndent(row.chars);

                                /* Create a new region is there is none */
                                if (currRegion === null) {
                                    currRegion = { x:rowIndent, y1:r, y2:(r+1), p:[] };
                                }

                                /* Check if indentation has changed and we had text of last row */
                                if ((rowIndent !== lastRowIndentL) && lastRowHasText) {
                                    currRegion.p.push(currP);
                                    currP = { start:startTime, end:endTime, spans:[] };
                                    currRegion.y2 = r;
                                    currRegion.name = 'region_' + currRegion.x + "_" + currRegion.y1 + "_" + currRegion.y2;
                                    if (false === seenRegions.hasOwnProperty(currRegion.name)) {
                                        regions.push(currRegion);
                                        seenRegions[currRegion.name] = currRegion;
                                    } else {
                                        existingRegion = seenRegions[currRegion.name];
                                        existingRegion.p.contat(currRegion.p);
                                    }

                                    currRegion = { x:rowIndent, y1:r, y2:(r+1), p:[] };
                                }

                                for (var c = 0; c < row.chars.length; ++c) {
                                    var uc = row.chars[c];
                                    var currPenState = uc.penState;
                                    if ((prevPenState === null) || (!currPenState.equals(prevPenState))) {
                                        if (line.trim().length > 0) {
                                            currP.spans.push({ name:currentStyle, line:line, row:r });
                                            line = '';
                                        }

                                        var currPenStateString = "style_cea608_" + currPenState.foreground + "_" + currPenState.background;
                                        if (currPenState.underline) {
                                            currPenStateString += "_underline";
                                        }
                                        if (currPenState.italics) {
                                            currPenStateString += "_italics";
                                        }

                                        if (!styleStates.hasOwnProperty(currPenStateString)) {
                                            styleStates[currPenStateString] = JSON.parse(JSON.stringify(currPenState));
                                        }

                                        prevPenState = currPenState;

                                        currentStyle = currPenStateString;
                                    }

                                    line += uc.uchar;
                                }

                                if (line.trim().length > 0) {
                                    currP.spans.push({ name:currentStyle, line:line, row:r });
                                }

                                lastRowHasText = true;
                                lastRowIndentL = rowIndent;
                            } else {
                                /* Row is empty */
                                lastRowHasText = false;
                                lastRowIndentL = -1;

                                if (currRegion) {
                                    currRegion.p.push(currP);
                                    currP = { start:startTime, end:endTime, spans:[] };
                                    currRegion.y2 = r;
                                    currRegion.name = 'region_' + currRegion.x + "_" + currRegion.y1 + "_" + currRegion.y2;
                                    if (false === seenRegions.hasOwnProperty(currRegion.name)) {
                                        regions.push(currRegion);
                                        seenRegions[currRegion.name] = currRegion;
                                    } else {
                                        existingRegion = seenRegions[currRegion.name];
                                        existingRegion.p.contat(currRegion.p);
                                    }

                                    currRegion = null;
                                }

                            }
                        }

                        if (currRegion) {
                            currRegion.p.push(currP);
                            currRegion.y2 = r + 1;
                            currRegion.name = 'region_' + currRegion.x + "_" + currRegion.y1 + "_" + currRegion.y2;
                            if (false === seenRegions.hasOwnProperty(currRegion.name)) {
                                regions.push(currRegion);
                                seenRegions[currRegion.name] = currRegion;
                            } else {
                                existingRegion = seenRegions[currRegion.name];
                                existingRegion.p.contat(currRegion.p);
                            }

                            currRegion = null;
                        }

                        //console.log(styleStates);
                        //console.log(regions);

                        var captionsArray = [];
                    
                        /* Loop thru regions */
                        for (r = 0; r < regions.length; ++r) {
                            var region = regions[r];

                            var cueID = "sub_" + (captionId++);
                            var finalDiv = document.createElement('div');
                            finalDiv.id = "subtitle_" + cueID;
                            var cueRegionProperties = getRegionProperties(region);
                            finalDiv.style.cssText = "position: absolute; margin: 0; display: flex; box-sizing: border-box; pointer-events: none;" + cueRegionProperties;

                            var bodyDiv = document.createElement('div');
                            bodyDiv.className = "paragraph bodyStyle";
                            bodyDiv.style.cssText = getStyle();

                            var cueUniWrapper = document.createElement('div');
                            cueUniWrapper.className = "cueUniWrapper";
                            cueUniWrapper.style.cssText = "unicode-bidi: normal; direction: ltr;";

                            for (var p = 0; p < region.p.length; ++p) {
                                var ptag = region.p[p];
                                var lastSpanRow = 0;
                                for (s = 0; s < ptag.spans.length; ++s) {
                                    var span = ptag.spans[s];
                                    if (span.line.length > 0) {
                                        if ((s !== 0) && lastSpanRow != span.row) {
                                            var brElement = document.createElement('br');
                                            brElement.className = "lineBreak";
                                            cueUniWrapper.appendChild(brElement);
                                        }
                                        var sameRow = false;
                                        if (lastSpanRow === span.row) {
                                            sameRow = true;
                                        }
                                        lastSpanRow = span.row;
                                        var spanStyle = styleStates[span.name];
                                        var spanElement = document.createElement('span');
                                        spanElement.className = "spanPadding " + span.name + " customSpanColor";
                                        spanElement.style.cssText = getStyle(spanStyle);
                                        if ((s !== 0) && sameRow) {
                                            if (s === ptag.spans.length - 1) {
                                                spanElement.textContent = rtrim(span.line);
                                            } else {
                                                spanElement.textContent = span.line;
                                            }
                                        } else {
                                            if (s === 0) {
                                                if (ptag.spans.length > 1) {
                                                    /* Check if next text is on same row */
                                                    if (span.row === ptag.spans[1].row) {
                                                        /* Next element on same row, trim start */
                                                        spanElement.textContent = ltrim(span.line);
                                                    } else {
                                                        /* Different rows, trim */
                                                        spanElement.textContent = span.line.trim();
                                                    }
                                                } else {
                                                    spanElement.textContent = span.line.trim();
                                                }
                                            } else {
                                                spanElement.textContent = span.line.trim();
                                            }
                                        }
                                        cueUniWrapper.appendChild(spanElement);
                                    }
                                }
                            }

                            bodyDiv.appendChild(cueUniWrapper);

                            finalDiv.appendChild(bodyDiv);

                            var fontSize = { 'bodyStyle':90 };
                            for (s in styleStates) {
                                if (styleStates.hasOwnProperty(s)) {
                                    fontSize[s] = 90;
                                }
                            }

                            captionsArray.push({ type:'html',
                                                 start:startTime,
                                                 end:endTime,
                                                 cueHTMLElement:finalDiv,
                                                 cueID:cueID,
                                                 cellResolution:[32, 15],
                                                 isFromCEA608: true,
                                                 regions: regions,
                                                 regionID: region.name,
                                                 videoHeight   : vm.videoHeight,
                                                 videoWidth    : vm.videoWidth,
                                                 fontSize      : fontSize || {
                                                     defaultFontSize: '100'
                                                 },
                                                 lineHeight    : {},
                                                 linePadding   : {},
                                               });
                        }
                        return captionsArray;
                    };
                    
                    if (embeddedCcTimescale && embeddedSegmentNumbers.indexOf(sequenceNumber) == -1) {
                        if (cea608LastSegNr !== null && sequenceNumber !== cea608LastSegNr+1) {
                            for ( i = 0 ; i < cea608FieldParsers.length ; i++) {
                                if (cea608FieldParsers[i]) {
                                    cea608FieldParsers[i].reset();
                                }
                            }
                        }
                        var allCcData = this.checkCC(bytes);
                        
                        for (var fieldNr = 0 ; fieldNr < cea608FieldParsers.length ; fieldNr++) {
                            var ccData = allCcData.fields[fieldNr];
                            var fieldParser = cea608FieldParsers[fieldNr];
                            if (fieldParser) {
                                /*if (ccData.length > 0 ) {
                                    console.log("CEA-608 adding Data to field " + fieldNr + " " + ccData.length + "bytes");
                                }*/
                                for (i = 0; i < ccData.length; i++) {
                                    fieldParser.addData(ccData[i][0] / embeddedCcTimescale, ccData[i][1]);
                                }
                                if (allCcData.endTime) {
                                    fieldParser.cueSplitAtTime(allCcData.endTime / embeddedCcTimescale);
                                }
                            }
                        }
                        cea608LastSegNr = sequenceNumber;
                        embeddedSegmentNumbers.push(sequenceNumber);
                    }
                }
            } else {
                bytes = new Uint8Array(bytes);
                ccContent=window.UTF8.decode(bytes);
                try {
                    result = self.getParser(mimeType).parse(ccContent);
                    createTextTrackFromMediaInfo(result, mediaInfo);
                } catch(e) {
                    self.errHandler.closedCaptionsError(e, "parse", ccContent);
                }
            }
        },

        checkCC : function(data) {
            
            /** Insert [time, data] pairs in order into array. */
            var insertInOrder = function(arr, time, data) {
                var len = arr.length;
                if (len > 0) {
                    if (time >= arr[len-1][0]) {
                        arr.push([time, data]);
                    } else {
                        for (var pos = len-1 ; pos >= 0 ; pos--) {
                            if (time < arr[pos][0]) {
                                arr.splice(pos, 0, [time, data]);
                                break;
                            }
                        }
                    }
                } else {
                    arr.push([time, data]);
                }
            };
            
            var isoFile = this.boxParser.parse(data);
            var moof = isoFile.getBox('moof');
            var mfhd = isoFile.getBox('mfhd');
            console.log("CEA: segment #: " + mfhd.sequence_number);
            var tfdt = isoFile.getBox('tfdt');
            //var tfhd = isoFile.getBox('tfhd'); //Can have a base_data_offset and other default values
            //console.log("tfhd: " + tfhd);
            //var saio = isoFile.getBox('saio'); // Offset possibly
            //var saiz = isoFile.getBox('saiz'); // Possible sizes
            var truns = isoFile.getBoxes('trun'); //
            var trun = null;
            
            if (truns.length === 0) {
                return null;
            }
            trun = truns[0];
            if (truns.length > 1) {
                console.log("Too many truns");
            }
            var baseOffset = moof.offset + trun.data_offset;
            //Doublecheck that trun.offset == moof.size + 8
            var sampleCount = trun.sample_count;
            var startPos = baseOffset;
            var baseSampleTime = tfdt.baseMediaDecodeTime;
            var raw = new DataView(data);
            var allCcData = {'startTime'  : null, 'endTime': null, fields : [[], []]};
            var accDuration = 0;
            for (var i=0  ; i < sampleCount ; i++) {
                var sample = trun.samples[i];
                var sampleTime = baseSampleTime + accDuration + sample.sample_composition_time_offset;
                var ccDataWindows = this.checkNalus(raw, startPos, sample.sample_size);
                for (var j = 0; j < ccDataWindows.length; j++) {
                    var ccData = this.processCCWindow(raw, ccDataWindows[j]);
                    for (var k=0 ; k < 2 ; k++) {
                        if (ccData[k].length > 0) {
                            insertInOrder(allCcData.fields[k], sampleTime, ccData[k]);
                        }
                    }
                }
                
                accDuration += sample.sample_duration;
                startPos += sample.sample_size;
            }
            var endSampleTime = baseSampleTime + accDuration;
            allCcData.startTime = baseSampleTime;
            allCcData.endTime = endSampleTime;
            return allCcData;
        },
        
        /**
         * Check NAL Units for embedded CEA-608 data
         */
        checkNalus : function(raw, startPos, size) {
            var nalSize = 0,
                _cursor = startPos,
                nalType = 0,
                cea608Data = [],
                   // Check SEI data according to ANSI-SCTE 128
                isCEA608SEI = function(payloadType, payloadSize, raw, pos) {
                    if (payloadType !== 4 || payloadSize < 8) {
                        return null;
                    }
                    var countryCode = raw.getUint8(pos);
                    var providerCode = raw.getUint16(pos+1);
                    var userIdentifier = raw.getUint32(pos+3);
                    var userDataTypeCode = raw.getUint8(pos+7);
                    return countryCode == 0xB5 && providerCode == 0x31 && userIdentifier == 0x47413934 && userDataTypeCode == 0x3;
                };
            while (_cursor < startPos + size) {
                nalSize = raw.getUint32(_cursor);
                nalType = raw.getUint8(_cursor+4) & 0x1F;
                //console.log(time + "  NAL " + nalType);
                if (nalType === 6) {
                    // SEI NAL. The NAL header is the first byte
                    //console.log("SEI NALU of size " + nalSize + " at time " + time);
                    var pos = _cursor+5;
                    var payloadType = -1;
                    while (pos < _cursor + 4 + nalSize -1) { // The last byte should be rbsp_trailing_bits
                        payloadType = 0;
                        var b = 0xFF;
                        while (b === 0xFF) {
                            b = raw.getUint8(pos);
                            payloadType += b;
                            pos++;
                        }
                        var payloadSize = 0;
                        b = 0xFF;
                        while (b === 0xFF) {
                            b = raw.getUint8(pos);
                            payloadSize += b;
                            pos++;
                        }
                        if (isCEA608SEI(payloadType, payloadSize, raw, pos)) {
                            //console.log("CEA608 SEI " + time + " " + payloadSize);
                            cea608Data.push([pos, payloadSize]);
                        }
                        pos += payloadSize;
                    }
                }
                _cursor += nalSize + 4;
            }
            return cea608Data;
        },
        
        processCCWindow : function(raw, ccDataWindow) {
          var pos = ccDataWindow[0];
          var fieldData = [[], []];
          
          pos += 8; // Skip the identifier up to userDataTypeCode
          var ccCount = raw.getUint8(pos) & 0x1f;
          pos += 2; // Advance 1 and skip reserved byte
          
          for (var i=0 ; i < ccCount ; i++) {
              var byte = raw.getUint8(pos);
              var ccValid = byte & 0x4;
              var ccType = byte & 0x3;
              pos++;
              var ccData1 = raw.getUint8(pos);// & 0x7f; // Skip parity bit
              pos++;
              var ccData2 = raw.getUint8(pos);// & 0x7f; // Skip parity bit
              pos++;
              if (ccValid && ((ccData1 & 0x7f) + (ccData2 & 0x7f) !== 0)) { //Check validity and non-empty data
                  if (ccType === 0) {
                      fieldData[0].push(ccData1);
                      fieldData[0].push(ccData2);
                  } else if (ccType === 1) {
                      fieldData[1].push(ccData1);
                      fieldData[1].push(ccData2);
                  }
              }
          }
          return fieldData;
        },

        getIsDefault:function(mediaInfo){
            //TODO How to tag default. Currently CEA-608 first, then the first track in manifest.
            // Is there a way to mark a text adaptation set as the default one? DASHIF meeting talk about using role which is being used for track KIND
            // Eg subtitles etc. You can have multiple role tags per adaptation Not defined in the spec yet.
            var isDefault = false;
            if (embeddedCcTracks.length > 1) {
               isDefault = (mediaInfo.id && mediaInfo.id === "CC1"); // CC1 if both CC1 and CC3 exist
            } else if (embeddedCcTracks.length === 1) {
                if (mediaInfo.id && mediaInfo.id.substring(0, 2) === "CC") {// Either CC1 or CC3
                    isDefault = true;
                }
            } else {
                isDefault = (mediaInfo.index === this.mediaInfos[0].index);
            }
            return isDefault;
        },

        abort:function() {
            this.textTrackExtensions.deleteAllTextTracks();
            allTracksAreDisabled = false;
            parser = null;
            this.sp = null;
            this.mediaInfos = null;
            this.isFragmented = null;
        },
        
        addEmbeddedTrack:function(mediaInfo) {
            if (mediaInfo.id === "CC1" || mediaInfo.id === "CC3") {
               embeddedCcTracks.push(mediaInfo);
            } else {
                console.warn("Embedded track " + mediaInfo.id + " not supported!");
            }
        },
        
        resetEmbeddedCc:function() {
            for (var i = 0 ; i < cea608FieldParsers.length ; i++) {
                if (cea608FieldParsers[i]) {
                    cea608FieldParsers[i].reset();
                }
            }
            cea608FieldParsers = [null, null];
            embeddedCcTracks = [];
            embeddedCcTimescale = 0;
            embeddedSegmentNumbers = [];
            cea608LastSegNr = null;
            this.abort();
        },

        getParser:function(mimeType) {
            var parser;
            if (mimeType === "text/vtt") {
                parser = this.system.getObject("vttParser");
            } else if (mimeType === "application/ttml+xml" || mimeType === "application/mp4") {
                parser = this.system.getObject("ttmlParser");
            }
            return parser;
        },

        getAllTracksAreDisabled : function (){
            return allTracksAreDisabled;
        },
        
        remove : function(start, end) {
            this.buffered.remove(start, end);
        },

        setTextTrack: setTextTrack,
    };
};

MediaPlayer.dependencies.TextSourceBuffer.prototype = {
    constructor: MediaPlayer.dependencies.TextSourceBuffer
};
