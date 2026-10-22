/* Azure microphone recognition for iPhone home-screen mode. No API keys are embedded. */
(()=>{
  class IPhoneSpeechRecognizer{
    constructor({settings,token,sdk,media}){this.settings=settings;this.token=token;this.sdk=sdk;this.media=media;this.lang='zh-TW';this.continuous=true;this._run=null;}
    start(){
      if(this._run)return;
      const run={stream:null,recognizer:null,audio:null,ended:false,finals:[],timer:null,cleanup:null};this._run=run;
      run.timer=setTimeout(()=>this._fail(run,{name:'NetworkError'}),20000);
      // Request the microphone directly from the student's click, before any network await.
      let requested;
      try{requested=this.media.getUserMedia({video:false,audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}catch(e){this._fail(run,e);return;}
      this._start(run,requested);
    }
    async _start(run,requested){
      try{
        run.stream=await requested;
        if(this._run!==run){this._release(run);return;}
        run.cleanup=this.oncapture?.(run.stream);
        const st=this.settings();const sdk=this.sdk;
        const tok=st.proxyUrl?await this.token():null;
        if(this._run!==run){this._release(run);return;}
        const cfg=tok?sdk.SpeechConfig.fromAuthorizationToken(tok.token,tok.region):sdk.SpeechConfig.fromSubscription(st.azKey,st.azRegion);
        cfg.speechRecognitionLanguage=this.lang;
        if(cfg.setProperty&&sdk.PropertyId?.Speech_SegmentationSilenceTimeoutMs)cfg.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,'2500');
        run.audio=sdk.AudioConfig.fromStreamInput(run.stream);
        const r=run.recognizer=new sdk.SpeechRecognizer(cfg,run.audio);
        const idle=()=>{clearTimeout(run.timer);run.timer=setTimeout(()=>this._fail(run,{name:'IdleError'}),30000);};
        const emit=(text,final)=>{
          if(this._run!==run||!text)return;
          idle();
          const result=Object.assign([{transcript:text}],{isFinal:final});
          const results=run.finals.concat([result]);
          if(final)run.finals.push(result);
          this.onresult?.({resultIndex:results.length-1,results});
          if(final&&!this.continuous)this.stop();
        };
        r.recognizing=(_,e)=>emit(e.result?.text,false);
        r.recognized=(_,e)=>{if(e.result?.reason===sdk.ResultReason.RecognizedSpeech)emit(e.result.text,true);};
        r.canceled=(_,e)=>{if(this._run===run)this._fail(run,{name:'NetworkError',message:'Azure 語音連線中斷，請檢查課程設定與網路後重試。'});};
        r.sessionStopped=()=>{if(this._run===run)this.stop();};
        r.startContinuousRecognitionAsync(()=>{if(this._run===run){idle();this.onstart?.();}else this._release(run);},e=>this._fail(run,{name:'NetworkError',message:String(e)}));
      }catch(e){this._fail(run,e);}
    }
    _release(run){
      clearTimeout(run.timer);try{run.cleanup?.();}catch{}run.cleanup=null;
      run.stream?.getTracks().forEach(t=>t.stop());
      const r=run.recognizer;run.recognizer=null;
      if(r){r.recognizing=r.recognized=r.canceled=r.sessionStopped=()=>{};try{r.close();}catch{}}
      try{run.audio?.close();}catch{}run.audio=null;
    }
    _end(run){
      if(run.ended)return;run.ended=true;
      if(this._run===run)this._run=null;
      this._release(run);this.onend?.();
    }
    _fail(run,e){
      if(this._run!==run){this._release(run);return;}
      const error=e?.name==='IdleError'?'idle':e?.name==='NotAllowedError'?'not-allowed':e?.name==='NotFoundError'||e?.name==='NotReadableError'?'audio-capture':'network';
      this.onerror?.({error,message:error==='idle'?'暫停收音：30 秒未收到語音，按麥克風可繼續':error==='network'?'Azure 語音連線失敗，請檢查課程設定與網路。':e?.message||''});this._end(run);
    }
    stop(){if(this._run)this._end(this._run);}
    abort(){this.stop();}
  }
  window.IPhoneSpeechRecognizer=IPhoneSpeechRecognizer;
})();
