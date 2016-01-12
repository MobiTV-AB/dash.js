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
import TextTrackInfo from './vo/TextTrackInfo.js';
import FragmentExtensions from '../dash/extensions/FragmentExtensions.js';
import BoxParser from './utils/BoxParser.js';
import CustomTimeRanges from './utils/CustomTimeRanges.js';
import FactoryMaker from '../core/FactoryMaker.js';
import Debug from '../core/Debug.js';
import VideoModel from './models/VideoModel.js';
import TextTrackExtensions from './extensions/TextTrackExtensions.js';

function TextSourceBuffer() {

    let context = this.context;    
    let log = Debug(context).getInstance().log;
    let embeddedInitialized = false;

    let instance,
        boxParser,
        errHandler,
        adapter,
        manifestExt,
        mediaController,
        allTracksAreDisabled,
        parser,
        VTTParser,
        TTMLParser,
        fragmentExt,
        mediaInfos,
        textTrackExtensions,
        isFragmented,
        fragmentModel,
        initializationSegmentReceived,
        timescale,
        fragmentedTracks,
        videoModel,
        streamController,
        firstSubtitleStart,
        currFragmentedTrackIdx,
        embeddedTracks,
        embeddedInitializationSegmentReceived,
        embeddedTimescale,
        embeddedLastSequenceNumber,
        embeddedSequenceNumbers,
        embeddedCea608FieldParsers;

    function initialize(type, bufferController) {
        log("TOBBE: TextSourceBuffer: initialize");
        allTracksAreDisabled = false;
        parser = null;
        fragmentExt = null;
        fragmentModel = null;
        initializationSegmentReceived = false;
        timescale = NaN;
        fragmentedTracks = [];
        firstSubtitleStart = null;
        
        if (!embeddedInitialized) {
            initEmbedded();
        }

        let streamProcessor = bufferController.getStreamProcessor();

        mediaInfos = streamProcessor.getMediaInfoArr();
        textTrackExtensions.setConfig({videoModel: videoModel});
        textTrackExtensions.initialize();
        isFragmented = !manifestExt.getIsTextTrack(type);
        boxParser = BoxParser(context).getInstance();
        fragmentExt = FragmentExtensions(context).getInstance();
        fragmentExt.setConfig({boxParser: boxParser});
        if (isFragmented) {
            fragmentModel = streamProcessor.getFragmentModel();
            this.buffered =  CustomTimeRanges(context).create();
            fragmentedTracks = mediaController.getTracksFor("fragmentedText", streamController.getActiveStreamInfo());
            var currFragTrack = mediaController.getCurrentTrackFor("fragmentedText", streamController.getActiveStreamInfo());
            for (var i = 0 ; i < fragmentedTracks.length; i++) {
               if (fragmentedTracks[i] === currFragTrack) {
                   currFragmentedTrackIdx = i;
                   break;
               }
            }
        }
    }
    
    function initEmbedded() {
        log("TOBBE initEmbedded");
        embeddedTracks = [];
        mediaInfos = [];
        videoModel = VideoModel(context).getInstance();
        textTrackExtensions = TextTrackExtensions(context).getInstance();
        textTrackExtensions.setConfig({videoModel: videoModel});
        textTrackExtensions.initialize();
        boxParser = BoxParser(context).getInstance();
        fragmentExt = FragmentExtensions(context).getInstance();
        fragmentExt.setConfig({boxParser: boxParser});
        isFragmented = false;
        currFragmentedTrackIdx = null;
        embeddedInitializationSegmentReceived = false;
        embeddedTimescale = 0;
        embeddedCea608FieldParsers = [];
        embeddedSequenceNumbers = [];
        embeddedLastSequenceNumber = null;
        embeddedInitialized = true;
    }

    function append(bytes, chunk) {
        log("TOBBE TextSourceBuffer:append()");
        var result,
            sampleList,
            i,
            samplesInfo,
            ccContent;
        var mediaInfo = chunk.mediaInfo;
        var mediaType = mediaInfo.type;
        var mimeType = mediaInfo.mimeType;

        function createTextTrackFromMediaInfo(captionData, mediaInfo) {
            log("TOBBE createTextTrackFromMediaInfo");
            var textTrackInfo = new TextTrackInfo();
            var trackKindMap = { subtitle: 'subtitles', caption: 'captions' }; //Dash Spec has no "s" on end of KIND but HTML needs plural.
            var getKind = function () {
                var kind = (mediaInfo.roles.length > 0) ? trackKindMap[mediaInfo.roles[0]] : trackKindMap.caption;
                kind = (kind === trackKindMap.caption || kind === trackKindMap.subtitle) ? kind : trackKindMap.caption;
                return kind;
            };

            var checkTTML = function () {
                var ttml = false;
                if (mediaInfo.codec && mediaInfo.codec.search('stpp') >= 0) {
                    ttml = true;
                }
                if (mediaInfo.mimeType && mediaInfo.mimeType.search('ttml') >= 0) {
                    ttml = true;
                }
                return ttml;
            };
            
            textTrackInfo.captionData = captionData;
            textTrackInfo.lang = mediaInfo.lang;
            textTrackInfo.label = mediaInfo.id; // AdaptationSet id (an unsigned int)
            textTrackInfo.index = mediaInfo.index; // AdaptationSet index in manifest
            textTrackInfo.isTTML = checkTTML();
            textTrackInfo.video = videoModel.getElement();
            textTrackInfo.defaultTrack = getIsDefault(mediaInfo);
            textTrackInfo.isFragmented = isFragmented;
            textTrackInfo.isEmbedded = mediaInfo.isEmbedded ? true : false;
            textTrackInfo.kind = getKind();
            log("TOBBE: Adding " + mediaInfo.id);
            var totalNrTracks = (mediaInfos ? mediaInfos.length : 0) + embeddedTracks.length;
            textTrackExtensions.addTextTrack(textTrackInfo, totalNrTracks);
        }

        if (mediaType === 'fragmentedText') {
            if (!initializationSegmentReceived) {
                initializationSegmentReceived = true;
                for (i = 0; i < mediaInfos.length; i++) {
                    createTextTrackFromMediaInfo(null, mediaInfos[i]);
                }
                timescale = fragmentExt.getMediaTimescaleFromMoov(bytes);
            } else {
                samplesInfo = fragmentExt.getSamplesInfo(bytes);
                sampleList = samplesInfo.sampleList;
                for (i = 0 ; i < sampleList.length ; i++) {
                    if (!firstSubtitleStart) {
                        firstSubtitleStart = sampleList[0].cts - chunk.start * timescale;
                    }
                    sampleList[i].cts -= firstSubtitleStart;
                    this.buffered.add(sampleList[i].cts / timescale,(sampleList[i].cts + sampleList[i].duration) / timescale);
                    ccContent = window.UTF8.decode(new Uint8Array(bytes.slice(sampleList[i].offset, sampleList[i].offset + sampleList[i].size)));
                    parser = parser !== null ? parser : getParser(mimeType);
                    try {
                        result = parser.parse(ccContent);
                        textTrackExtensions.addCaptions(currFragmentedTrackIdx, firstSubtitleStart / timescale, result);
                    } catch (e) {
                        //empty cue ?
                    }
                }
            }
        } else if (mediaType === 'text') {
            bytes = new Uint8Array(bytes);
            ccContent = window.UTF8.decode(bytes);
            try {
                result = getParser(mimeType).parse(ccContent);
                createTextTrackFromMediaInfo(result, mediaInfo);
            } catch (e) {
                errHandler.timedTextError(e, 'parse', ccContent);
            }
        } else if (mediaType === 'video') { //embedded text
            if (chunk.segmentType === "Initialization Segment") {
                if (embeddedTimescale === 0) {
                    embeddedTimescale = fragmentExt.getMediaTimescaleFromMoov(bytes);
                    for (i = 0; i < embeddedTracks.length; i++) {
                        createTextTrackFromMediaInfo(null, embeddedTracks[i]);
                    }
                }
            } else { // MediaSegment
                if (embeddedTimescale === 0) {
                    log("CEA-608: No timescale for embeddedTextTrack yet");
                    return;
                }
                var makeCueAdderForIndex = function (self, trackIndex) {
                    function newCue(startTime, endTime, captionScreen) {
                        var captionsArray = null;
                        /*if (self.videoModel.getTTMLRenderingDiv()) {
                            captionsArray = createHTMLCaptionsFromScreen(self.videoModel.getElement(), startTime, endTime, captionScreen);
                        } else { */
                        var text = captionScreen.getDisplayText();
                        //console.log("CEA text: " + startTime + "-" + endTime + "  '" + text + "'");
                        captionsArray = [{ start: startTime, end: endTime, data: text, styles: {} }];
                        /* } */
                        if (captionsArray) {
                            textTrackExtensions.addCaptions(trackIndex, 0, captionsArray);
                        }
                    }
                    return newCue;
                };
                
            
                samplesInfo = fragmentExt.getSamplesInfo(bytes);
                var sequenceNumber = samplesInfo.sequenceNumber;
                log("TOBBE: CEA-608 sequence number: " + sequenceNumber);

                if (!embeddedCea608FieldParsers[0] && !embeddedCea608FieldParsers[1]) {
                    // Time to setup the CEA-608 parsing
                    let field, handler, trackIdx;
                    for (i = 0; i < embeddedTracks.length; i++) {
                        if (embeddedTracks[i].id === "CC1") {
                            field = 0;
                            trackIdx = textTrackExtensions.getTrackIdxForId("CC1");
                        } else if (embeddedTracks[i].id === "CC3") {
                            field = 1;
                            trackIdx = textTrackExtensions.getTrackIdxForId("CC3");
                        }
                        if (trackIdx === -1) {
                            console.log("CEA-608: data before track is ready.");
                            return;
                        }
                        handler = makeCueAdderForIndex(this, trackIdx);
                        embeddedCea608FieldParsers[i] = new cea608parser.Cea608Parser(i, { 'newCue': handler }, null);
                    }
                }

                if (embeddedTimescale && embeddedSequenceNumbers.indexOf(sequenceNumber) == -1) {
                    if (embeddedLastSequenceNumber !== null && sequenceNumber !== embeddedLastSequenceNumber + 1) {
                        for (i = 0; i < embeddedCea608FieldParsers.length; i++) {
                            if (embeddedCea608FieldParsers[i]) {
                                embeddedCea608FieldParsers[i].reset();
                            }
                        }
                    }
                    var allCcData = checkCC(bytes);

                    for (var fieldNr = 0; fieldNr < embeddedCea608FieldParsers.length; fieldNr++) {
                        var ccData = allCcData.fields[fieldNr];
                        var fieldParser = embeddedCea608FieldParsers[fieldNr];
                        if (fieldParser) {
                            /*if (ccData.length > 0 ) {
                                console.log("CEA-608 adding Data to field " + fieldNr + " " + ccData.length + "bytes");
                            }*/
                            for (i = 0; i < ccData.length; i++) {
                                fieldParser.addData(ccData[i][0] / embeddedTimescale, ccData[i][1]);
                            }
                            if (allCcData.endTime) {
                                fieldParser.cueSplitAtTime(allCcData.endTime / embeddedTimescale);
                            }
                        }
                    }
                    embeddedLastSequenceNumber = sequenceNumber;
                    embeddedSequenceNumbers.push(sequenceNumber);
                }
            }
        }
        log("Warning: Non-supported text type: " + mediaType);
    }
    
    function checkCC(data) {
        /** Insert [time, data] pairs in order into array. */
        var insertInOrder = function (arr, time, data) {
            var len = arr.length;
            if (len > 0) {
                if (time >= arr[len - 1][0]) {
                    arr.push([time, data]);
                } else {
                    for (var pos = len - 1; pos >= 0; pos--) {
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

        var isoFile = boxParser.parse(data);
        var moof = isoFile.getBox('moof');
        var mfhd = isoFile.getBox('mfhd');
        log("TOBBE CEA: segment #: " + mfhd.sequence_number);
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
        var allCcData = { 'startTime': null, 'endTime': null, fields: [[], []] };
        var accDuration = 0;
        for (var i = 0; i < sampleCount; i++) {
            var sample = trun.samples[i];
            var sampleTime = baseSampleTime + accDuration + sample.sample_composition_time_offset;
            var ccDataWindows = checkNalus(raw, startPos, sample.sample_size);
            for (var j = 0; j < ccDataWindows.length; j++) {
                var ccData = processCCWindow(raw, ccDataWindows[j]);
                for (var k = 0; k < 2; k++) {
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
    }
        
    /**
     * Check NAL Units for embedded CEA-608 data
     */
    function checkNalus(raw, startPos, size) {
        var nalSize = 0,
            _cursor = startPos,
            nalType = 0,
            cea608Data = [],
            // Check SEI data according to ANSI-SCTE 128
            isCEA608SEI = function (payloadType, payloadSize, raw, pos) {
                if (payloadType !== 4 || payloadSize < 8) {
                    return null;
                }
                var countryCode = raw.getUint8(pos);
                var providerCode = raw.getUint16(pos + 1);
                var userIdentifier = raw.getUint32(pos + 3);
                var userDataTypeCode = raw.getUint8(pos + 7);
                return countryCode == 0xB5 && providerCode == 0x31 && userIdentifier == 0x47413934 && userDataTypeCode == 0x3;
            };
        while (_cursor < startPos + size) {
            nalSize = raw.getUint32(_cursor);
            nalType = raw.getUint8(_cursor + 4) & 0x1F;
            //console.log(time + "  NAL " + nalType);
            if (nalType === 6) {
                // SEI NAL. The NAL header is the first byte
                //console.log("SEI NALU of size " + nalSize + " at time " + time);
                var pos = _cursor + 5;
                var payloadType = -1;
                while (pos < _cursor + 4 + nalSize - 1) { // The last byte should be rbsp_trailing_bits
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
    }

    function processCCWindow(raw, ccDataWindow) {
        var pos = ccDataWindow[0];
        var fieldData = [[], []];

        pos += 8; // Skip the identifier up to userDataTypeCode
        var ccCount = raw.getUint8(pos) & 0x1f;
        pos += 2; // Advance 1 and skip reserved byte
          
        for (var i = 0; i < ccCount; i++) {
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
    }

    function abort() {
        textTrackExtensions.deleteAllTextTracks();
        allTracksAreDisabled = false;
        parser = null;
        fragmentExt = null;
        mediaInfos = null;
        textTrackExtensions = null;
        isFragmented = false;
        fragmentModel = null;
        initializationSegmentReceived = false;
        timescale = NaN;
        fragmentedTracks = [];
        videoModel = null;
        streamController = null;
        embeddedInitialized = false;
        embeddedTracks = null;
    }
    
    function addEmbeddedTrack(mediaInfo) {
        log("TOBBE added embedded " + mediaInfo.id);
        if (!embeddedInitialized) {
            initEmbedded();
        }
        if (mediaInfo.id === "CC1" || mediaInfo.id === "CC3") {
            embeddedTracks.push(mediaInfo);
        } else {
            log("Warning: Embedded track " + mediaInfo.id + " not supported!");
        }
    }
    
    function resetEmbedded() {
        log("TOBBE: resetEmbedded");
        embeddedInitialized = false;
        embeddedTracks = [];
        embeddedCea608FieldParsers = [null, null];
        embeddedSequenceNumbers = [];
        embeddedLastSequenceNumber = null;
    }

    function getAllTracksAreDisabled() {
        return allTracksAreDisabled;
    }

    function setConfig(config) {
        if (!config) return;

        if (config.errHandler) {
            errHandler = config.errHandler;
        }
        if (config.adapter) {
            adapter = config.adapter;
        }
        if (config.manifestExt) {
            manifestExt = config.manifestExt;
        }
        if (config.mediaController) {
            mediaController = config.mediaController;
        }
        if (config.videoModel) {
            videoModel = config.videoModel;
        }
        if (config.streamController) {
            streamController = config.streamController;
        }
        if (config.textTrackExtensions) {
            textTrackExtensions = config.textTrackExtensions;
        }
        if (config.VTTParser) {
            VTTParser = config.VTTParser;
        }
        if (config.TTMLParser) {
            TTMLParser = config.TTMLParser;
        }
    }

    function setTextTrack() {

        var el = videoModel.getElement();
        var tracks = el.textTracks;
        var ln = tracks.length;
        var nrNonEmbeddedTracks = ln - embeddedTracks.length;
        var oldTrackIdx = textTrackExtensions.getCurrentTrackIdx();

        for (var i = 0; i < ln; i++ ) {
            var track = tracks[i];
            allTracksAreDisabled = track.mode !== 'showing';
            if (track.mode === 'showing') {
                if (oldTrackIdx !== i) { // do not reset track if already the current track.  This happens when all captions get turned off via UI and then turned on again and with videojs.
                    textTrackExtensions.setCurrentTrackIdx(i);
                    textTrackExtensions.addCaptions(i, 0, null); // Make sure that previously queued captions are added as cues
                    if (isFragmented && i < nrNonEmbeddedTracks) {
                        var currentFragTrack = mediaController.getCurrentTrackFor("fragmentedText", streamController.getActiveStreamInfo());
                        var newFragTrack = fragmentedTracks[i];
                        if (newFragTrack !== currentFragTrack) {
                            fragmentModel.abortRequests();
                            textTrackExtensions.deleteTrackCues(currentFragTrack);
                            mediaController.setTrack(newFragTrack);
                            currFragmentedTrackIdx = i;
                        }
                    }
                }
                break;
            }
        }

        if (allTracksAreDisabled) {
            textTrackExtensions.setCurrentTrackIdx(-1);
        }
    }

    function getIsDefault(mediaInfo) {
        //TODO How to tag default. currently same order as listed in manifest.
        // Is there a way to mark a text adaptation set as the default one? DASHIF meeting talk about using role which is being used for track KIND
        // Eg subtitles etc. You can have multiple role tags per adaptation Not defined in the spec yet.
        var isDefault = false;
        if (embeddedTracks.length > 1) {
            isDefault = (mediaInfo.id && mediaInfo.id === "CC1"); // CC1 if both CC1 and CC3 exist
        } else if (embeddedTracks.length === 1) {
            if (mediaInfo.id && mediaInfo.id.substring(0, 2) === "CC") {// Either CC1 or CC3
                isDefault = true;
            }
        } else {
            isDefault = (mediaInfo.index === mediaInfos[0].index);
        }
        return isDefault;
    }

    function getParser(mimeType) {
        var parser;
        if (mimeType === 'text/vtt') {
            parser = VTTParser;
        } else if (mimeType === 'application/ttml+xml' || mimeType === 'application/mp4') {
            parser = TTMLParser;
            parser.setConfig({videoModel: videoModel});
        }
        return parser;
    }

    instance = {
        initialize: initialize,
        append: append,
        abort: abort,
        getAllTracksAreDisabled: getAllTracksAreDisabled,
        setTextTrack: setTextTrack,
        setConfig: setConfig,
        addEmbeddedTrack: addEmbeddedTrack,
        resetEmbedded: resetEmbedded
    };

    return instance;
}

export default FactoryMaker.getSingletonFactory(TextSourceBuffer);