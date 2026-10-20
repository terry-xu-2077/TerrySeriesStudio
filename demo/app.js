/* TerrySeriesStudio Word-like review interaction demo.
   Static, deterministic mock AI. No network, API keys, ComfyUI or backend. */
(function () {
  "use strict";

  var STORAGE_KEY = "terry-series-studio-review-demo-v1";
  var demoScript = [
    {id:"sc01-heading",kind:"scene",text:"场景 01     基地内部 / 夜"},
    {id:"sc01-action1",kind:"action",text:"灯光不太稳定。特瑞坐在工作台旁，盯着一堆刚带回来的旧零件。风从门边的缝隙里灌进来，带着轻微的金属摩擦声。"},
    {id:"sc01-action2",kind:"action",text:"小七的指示灯亮了一下。它在工作台周围转动，像是在等待一个答案。"},
    {id:"sc01-line1",kind:"dialogue",speaker:"特瑞",text:"我们没有别的选择了。"},
    {id:"sc01-line2",kind:"dialogue",speaker:"小七",text:"如果每一次都这样，我们到底是在修什么？"},
    {id:"sc01-action3",kind:"action",text:"特瑞没有立即回答。他把一枚生锈的螺丝慢慢放回桌面。"},
    {id:"sc02-heading",kind:"scene",text:"场景 02     基地外部 / 黎明"},
    {id:"sc02-action1",kind:"action",text:"远处的光缓慢地越过地平线。特瑞背起工具包，回头看了一眼基地，然后走进还没有完全散去的晨雾。"}
  ];
  var demoStoryboard = [
    {id:"shot-01",kind:"shot",label:"镜头 01  ·  8 秒",text:"广角建立镜头。基地内部光线昏暗，工作台位于画面右侧。特瑞独自坐在桌前，远处有轻微的电流声。"},
    {id:"shot-02",kind:"shot",label:"镜头 02  ·  6 秒",text:"中景。特瑞检查零件，镜头快速推近特瑞的面部。随后切到他手里的螺丝。"},
    {id:"shot-03",kind:"shot",label:"镜头 03  ·  8 秒",text:"小七从画面右侧进入。镜头没有交代它与特瑞的相对位置，直接给出双方的对话。"},
    {id:"shot-04",kind:"shot",label:"镜头 04  ·  7 秒",text:"特瑞放下螺丝。保持机位，让停顿持续片刻；室内环境声仍然存在。"},
    {id:"shot-05",kind:"shot",label:"镜头 05  ·  9 秒",text:"黎明的基地外部远景。人物转身离开，画面与上一镜头之间的动作衔接尚不明确。"}
  ];

  function initialState() {
    return {
      activeTab:"script",
      layout:"focus",
      documents:{script:clone(demoScript),storyboard:clone(demoStoryboard)},
      comments:{script:[],storyboard:[]},
      summaries:{script:"",storyboard:""},
      approved:{script:false,storyboard:false},
      revisions:{script:1,storyboard:1}
    };
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function elem(id) { return document.getElementById(id); }
  function query(selector) { return document.querySelector(selector); }
  function all(selector) { return Array.from(document.querySelectorAll(selector)); }
  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g,function(ch){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];
    });
  }
  function loadState() {
    try {
      var raw=localStorage.getItem(STORAGE_KEY);
      if(!raw) return initialState();
      var parsed=JSON.parse(raw);
      if(!parsed.documents || !parsed.documents.script || !parsed.documents.storyboard ||
         !parsed.comments || !parsed.comments.script || !parsed.comments.storyboard) return initialState();
      return {
        activeTab:["script","storyboard","generate"].includes(parsed.activeTab)?parsed.activeTab:"script",
        layout:parsed.layout==="full"?"full":"focus",
        documents:parsed.documents,
        comments:parsed.comments,
        summaries:parsed.summaries || {script:"",storyboard:""},
        approved:parsed.approved || {script:false,storyboard:false},
        revisions:parsed.revisions || {script:1,storyboard:1}
      };
    } catch(error) { return initialState(); }
  }

  var state=loadState();
  var undoHistory=[],redoHistory=[];
  var currentSelection=null,composerSelection=null;
  var focusedEdit=null,selectedCommentId=null,reviewFilter="all";
  var reviewing=false,saveTimer=null,toastTimer=null;
  var hoveredCommentId=null,relationFramePending=false;
  var editor=elem("editorBlocks");
  var commentsView=elem("reviewItems");
  var composer=elem("commentComposer");
  var selectionToolbar=elem("selectionToolbar");
  var reviewRelations=elem("reviewRelations");

  function documentTab(){ return state.activeTab==="generate"?"storyboard":state.activeTab; }
  function currentBlocks(){ return state.documents[documentTab()]; }
  function currentComments(){ return state.comments[documentTab()]; }
  function currentRevision(){return "revision-" + state.revisions[documentTab()];}
  function getBlock(id){return currentBlocks().find(function(b){return b.id===id;});}
  function pendingCount(){return currentComments().filter(function(c){return c.status==="pending";}).length;}
  function snapshot(){return clone({
    documents:state.documents,comments:state.comments,summaries:state.summaries,
    approved:state.approved,revisions:state.revisions
  });}
  function recordBefore(value){
    undoHistory.push(value || snapshot());
    if(undoHistory.length>35) undoHistory.shift();
    redoHistory.length=0;
    updateUndoButtons();
  }
  function restoreSnapshot(value){
    state.documents=value.documents;
    state.comments=value.comments;
    state.summaries=value.summaries;
    state.approved=value.approved;
    state.revisions=value.revisions;
    selectedCommentId=null;
    closeComposer();
    paintAll();
    saveSoon();
  }
  function updateUndoButtons(){
    elem("undoButton").disabled=undoHistory.length===0;
    elem("redoButton").disabled=redoHistory.length===0;
  }
  function undo(){
    if(!undoHistory.length){notify("当前没有可撤销的操作");return;}
    redoHistory.push(snapshot());
    restoreSnapshot(undoHistory.pop());
  }
  function redo(){
    if(!redoHistory.length){notify("当前没有可重做的操作");return;}
    undoHistory.push(snapshot());
    restoreSnapshot(redoHistory.pop());
  }
  function saveSoon(){
    elem("saveStatus").classList.add("unsaved");
    elem("saveStatus").classList.remove("error");
    elem("saveStatus").lastChild.textContent=" 正在保存…";
    clearTimeout(saveTimer);
    saveTimer=setTimeout(saveNow,450);
  }
  function saveNow(){
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      elem("saveStatus").classList.remove("unsaved","error");
      elem("saveStatus").lastChild.textContent=" 所有更改已保存";
    }catch(error){
      elem("saveStatus").classList.add("error");
      elem("saveStatus").lastChild.textContent=" 保存失败：浏览器存储不可用";
      notify("无法保存到浏览器本地存储");
    }
  }
  function notify(message){
    var node=elem("toast");
    node.textContent=message;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){node.classList.remove("show");},2900);
  }
  function newId(){
    if(window.crypto && typeof window.crypto.randomUUID==="function")return window.crypto.randomUUID();
    return "review-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);
  }
  function labelForTab(tab){return tab==="script"?"剧本编辑":tab==="storyboard"?"分镜脚本":"视频生成";}
  function changeTab(tab){
    if(!["script","storyboard","generate"].includes(tab))return;
    currentSelection=null;
    closeComposer();
    state.activeTab=tab;
    selectedCommentId=null;
    reviewFilter="all";
    paintAll();
    saveSoon();
  }

  function setReviewOpen(open){
    var visible=!!open && state.activeTab!=="generate";
    elem("reviewSidebar").classList.toggle("open",visible);
    elem("openReview").setAttribute("aria-expanded",String(visible));
    elem("openReview").setAttribute("aria-label",visible?"收起右侧批改结果":"展开右侧批改结果");
    scheduleRelations();
  }
  function paintNavigation(){
    var tab=state.activeTab;
    var isFocus=state.layout!=="full";
    elem("appShell").classList.toggle("focus-layout",isFocus);
    elem("focusLabel").textContent=isFocus?"展开项目导航":"专注写作";
    elem("toggleFocus").setAttribute("aria-pressed",String(isFocus));
    all("[data-tab]").forEach(function(node){
      var selected=node.dataset.tab===tab;
      node.classList.toggle("active",selected);
      node.setAttribute("aria-selected",String(selected));
    });
    elem("toolbarScope").textContent=labelForTab(tab);
    elem("toolbarDoc").textContent=tab==="script"?"草稿 / 第 1 集":tab==="storyboard"?"镜头列表 / 第 1 集":"本地生成 / 示意";
    elem("docTitle").textContent=tab==="script"?"第一集 · 回收日":tab==="storyboard"?"第一集 · 镜头设计":"视频生成";
    elem("docSubtitle").textContent=tab==="script"
      ?"剧本初稿 · 直接点击文字编辑，选择文字即可批注。"
      :tab==="storyboard"
        ?"分镜草稿 · 双击与选区编辑一样自然；此处不调用真实 AI。"
        :"由批准的分镜进入本地 ComfyUI；当前仅展示产品流程。";
    elem("docKicker").textContent=tab==="script"?"EPISODE 01 · SCREENPLAY":tab==="storyboard"?"EPISODE 01 · SHOT LIST":"EPISODE 01 · LOCAL GENERATION";
    elem("versionLabel").textContent=tab==="generate"?"流程示意":"草稿 V"+state.revisions[tab]+(state.approved[tab]?" · 已批准":"");
    elem("approveButton").classList.toggle("approved",!!state.approved[documentTab()]);
    elem("approveLabel").textContent=state.approved[documentTab()]?"已批准":"批准本稿";
    elem("aiReviewButton").disabled=tab==="generate"||reviewing;
    elem("approveButton").disabled=tab==="generate";
    elem("approveButton").hidden=tab==="generate";
    elem("openReview").disabled=tab==="generate";
    elem("openReview").setAttribute("aria-label","展开右侧批改结果");
    elem("workArea").classList.toggle("is-generation",tab==="generate");
    elem("pendingCount").textContent=String(pendingCount());
    elem("reviewMobileCount").textContent=String(currentComments().length);
    updateUndoButtons();
  }
  function paintDocument(){
    editor.replaceChildren();
    if(state.activeTab==="generate"){
      editor.innerHTML='<div class="generation-state"><h2>从分镜到可用的视频镜头</h2>'
      +'<p>正式版本将在这里把批准后的分镜发送给本地 ComfyUI，并管理尾帧参考、片段续接、批量队列和局部重跑。</p>'
      +'<div class="step-row"><span class="step-icon">01</span><strong>确定分镜</strong><span class="step-value">由作者批准</span></div>'
      +'<div class="step-row"><span class="step-icon">02</span><strong>绑定参考素材</strong><span class="step-value">角色图 · 音频 · 场景</span></div>'
      +'<div class="step-row"><span class="step-icon">03</span><strong>调用 ComfyUI</strong><span class="step-value">尚未接入</span></div>'
      +'<div class="step-row"><span class="step-icon">04</span><strong>查看结果与局部重跑</strong><span class="step-value">尚未接入</span></div>'
      +'<div class="generation-actions"><button class="accent-button" type="button" id="returnToStoryboard">返回分镜编辑</button></div></div>';
      elem("returnToStoryboard").addEventListener("click",function(){changeTab("storyboard");});
      return;
    }
    currentBlocks().forEach(function(block){
      var section=document.createElement("section");
      section.className="doc-block kind-"+block.kind;
      section.dataset.blockId=block.id;
      if(block.label){
        var label=document.createElement("div");
        label.className="speaker-name";
        label.textContent=block.label;
        section.appendChild(label);
      }else if(block.speaker){
        var speaker=document.createElement("div");
        speaker.className="speaker-name";
        speaker.textContent=block.speaker;
        section.appendChild(speaker);
      }
      var editable=document.createElement("div");
      editable.className="block-editable";
      editable.contentEditable="true";
      editable.spellcheck=false;
      editable.setAttribute("role","textbox");
      editable.setAttribute("aria-multiline","true");
      editable.setAttribute("aria-label",block.label || block.speaker || block.id);
      editable.dataset.blockId=block.id;
      editable.textContent=block.text;
      editable.addEventListener("focus",function(){
        focusedEdit={blockId:block.id,before:block.text,shot:snapshot()};
      });
      editable.addEventListener("input",function(){
        var previous=block.text;
        block.text=editable.textContent || "";
        if(previous!==block.text){
          state.approved[documentTab()]=false;
          currentSelection=null;
          selectionToolbar.hidden=true;
          scheduleHighlights();
          saveSoon();
        }
      });
      editable.addEventListener("blur",function(){
        if(focusedEdit && focusedEdit.blockId===block.id){
          if(focusedEdit.before!==block.text){
            recordBefore(focusedEdit.shot);
            state.revisions[documentTab()]++;
            elem("versionLabel").textContent="草稿 V"+state.revisions[documentTab()];
            elem("approveButton").classList.remove("approved");
            elem("approveLabel").textContent="批准本稿";
            paintComments();
            saveSoon();
          }
          focusedEdit=null;
        }
      });
      editable.addEventListener("paste",function(event){
        event.preventDefault();
        var text=(event.clipboardData || window.clipboardData).getData("text/plain");
        document.execCommand("insertText",false,text);
      });
      editable.addEventListener("keydown",function(event){
        if(event.key==="Enter"){event.preventDefault();document.execCommand("insertText",false,"\n");}
        if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();startComment();}
      });
      section.appendChild(editable);
      editor.appendChild(section);
    });
    scheduleHighlights();
  }

  function getUniqueAnchor(comment){
    var block=getBlock(comment.block_id);
    if(!block)return {state:"missing"};
    var offset=block.text.indexOf(comment.quote);
    if(offset<0)return {state:"stale"};
    if(block.text.indexOf(comment.quote,offset+1)>=0)return {state:"ambiguous"};
    return {state:"ok",start:offset,end:offset+comment.quote.length};
  }
  function buildTextRange(element,start,end){
    var walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    var nodes=[],node;
    while((node=walker.nextNode()))nodes.push(node);
    if(!nodes.length)return null;
    var cursor=0,beginNode=null,beginPos=0,endNode=null,endPos=0;
    nodes.forEach(function(t){
      if(beginNode && endNode)return;
      var next=cursor+t.textContent.length;
      if(!beginNode && start>=cursor && start<=next){beginNode=t;beginPos=start-cursor;}
      if(!endNode && end>=cursor && end<=next){endNode=t;endPos=end-cursor;}
      cursor=next;
    });
    if(!beginNode||!endNode)return null;
    var range=document.createRange();
    range.setStart(beginNode,beginPos);
    range.setEnd(endNode,endPos);
    return range;
  }
  var highlightQueued=false;
  function scheduleHighlights(){
    if(highlightQueued)return;
    highlightQueued=true;
    requestAnimationFrame(function(){highlightQueued=false;paintHighlights();scheduleRelations();});
  }
  function paintHighlights(){
    all(".doc-block.is-related").forEach(function(n){n.classList.remove("is-related");});
    if(!window.CSS || !CSS.highlights || !window.Highlight)return;
    CSS.highlights.delete("review-anchors");
    CSS.highlights.delete("review-selected");
    CSS.highlights.delete("review-draft");
    if(state.activeTab==="generate")return;
    var standard=[],selected=[],draft=[];
    currentComments().forEach(function(comment){
      if(comment.status!=="pending")return;
      var anchor=getUniqueAnchor(comment);
      if(anchor.state!=="ok")return;
      var node=query('.block-editable[data-block-id="'+comment.block_id+'"]');
      if(!node)return;
      var range=buildTextRange(node,anchor.start,anchor.end);
      if(!range)return;
      if(comment.id===selectedCommentId)selected.push(range);
      else standard.push(range);
    });
    if(composerSelection){
      var selectedNode=query('.block-editable[data-block-id="'+composerSelection.blockId+'"]');
      if(selectedNode){
        var r=buildTextRange(selectedNode,composerSelection.start,composerSelection.end);
        if(r)draft.push(r);
      }
    }
    if(standard.length)CSS.highlights.set("review-anchors",new Highlight(...standard));
    if(selected.length)CSS.highlights.set("review-selected",new Highlight(...selected));
    if(draft.length)CSS.highlights.set("review-draft",new Highlight(...draft));
    if(selectedCommentId){
      var c=currentComments().find(function(c){return c.id===selectedCommentId;});
      if(c){
        var root=query('.doc-block[data-block-id="'+c.block_id+'"]');
        if(root)root.classList.add("is-related");
      }
    }
  }

  function scheduleRelations(){
    if(relationFramePending)return;
    relationFramePending=true;
    requestAnimationFrame(function(){relationFramePending=false;paintRelations();});
  }
  function paintRelations(){
    reviewRelations.replaceChildren();
    var sidebar=elem("reviewSidebar"),work=elem("workArea");
    if(!sidebar.classList.contains("open")||state.activeTab==="generate"||window.innerWidth<=850)return;
    var workRect=work.getBoundingClientRect(),pageRect=elem("pageScroller").getBoundingClientRect();
    var listRect=commentsView.getBoundingClientRect(),panelRect=sidebar.getBoundingClientRect();
    if(workRect.width<=0||workRect.height<=0)return;
    reviewRelations.setAttribute("viewBox","0 0 "+workRect.width+" "+workRect.height);
    var sourceXLimit=panelRect.left-22;
    var matching=currentComments().filter(function(comment){return comment.status==="pending";});
    matching.forEach(function(comment){
      var card=Array.from(commentsView.querySelectorAll(".comment-card")).find(function(el){return el.dataset.commentId===comment.id;});
      if(!card)return;
      var anchor=getUniqueAnchor(comment);
      if(anchor.state!=="ok")return;
      var block=query('.block-editable[data-block-id="'+comment.block_id+'"]');
      if(!block)return;
      var range=buildTextRange(block,anchor.start,anchor.end);
      if(!range)return;
      var rects=range.getClientRects();
      if(!rects.length)return;
      var source=rects[rects.length-1],cardRect=card.getBoundingClientRect();
      var sourceY=source.top+source.height/2,cardY=cardRect.top+Math.min(24,cardRect.height/2);
      // Do not draw lines from scrolled-away text or cards outside their own viewport.
      if(sourceY<pageRect.top+3||sourceY>pageRect.bottom-3 ||
         cardY<listRect.top+3||cardY>listRect.bottom-3)return;
      var x1=Math.min(source.right+5,sourceXLimit),x2=cardRect.left+2;
      var y1=sourceY-workRect.top,y2=cardY-workRect.top;
      x1-=workRect.left;x2-=workRect.left;
      if(x1>=x2||x1<0)return;
      var span=x2-x1,curve=Math.max(18,span*.46);
      var active=comment.id===selectedCommentId||comment.id===hoveredCommentId;
      var path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("class","relation-path"+(active?" active":""));
      path.setAttribute("d","M "+x1+" "+y1+" C "+(x1+curve)+" "+y1+", "+(x2-curve)+" "+y2+", "+x2+" "+y2);
      reviewRelations.appendChild(path);
      [{x:x1,y:y1},{x:x2,y:y2}].forEach(function(point){
        var dot=document.createElementNS("http://www.w3.org/2000/svg","circle");
        dot.setAttribute("cx",String(point.x));dot.setAttribute("cy",String(point.y));
        dot.setAttribute("r",active?"3.2":"2.1");
        dot.setAttribute("class","relation-dot"+(active?" active":""));
        reviewRelations.appendChild(dot);
      });
    });
  }

  function paintComments(){
    var comments=currentComments();
    elem("reviewCount").textContent=comments.length
      ? comments.length+" 条批注 · "+pendingCount()+" 条待处理"
      :"当前没有批注";
    elem("pendingCount").textContent=String(pendingCount());
    elem("reviewMobileCount").textContent=String(comments.length);
    all(".filter").forEach(function(button){button.classList.toggle("active",button.dataset.filter===reviewFilter);});
    commentsView.replaceChildren();
    var summary=state.summaries[documentTab()];
    if(summary && reviewFilter==="all"){
      var banner=document.createElement("div");
      banner.className="review-summary";
      banner.textContent="审查摘要 · "+summary;
      commentsView.appendChild(banner);
    }
    var order=new Map(currentBlocks().map(function(block,index){return [block.id,index];}));
    var visible=comments.filter(function(c){return reviewFilter==="all"||c.status==="pending";}).slice().sort(function(a,b){
      return (order.has(a.block_id)?order.get(a.block_id):99999)-(order.has(b.block_id)?order.get(b.block_id):99999);
    });
    if(!visible.length){
      commentsView.innerHTML+='<div class="empty-review"><div class="empty-art"><span></span><span></span></div>'
        +'<h3>'+(reviewFilter==="pending"?"没有待处理的批注":"从一次批注开始")+'</h3>'
        +'<p>'+(reviewFilter==="pending"?"当前建议已处理完毕。":"选中正文中的一句话添加批注，或让 AI 模拟审查这份文档。")+'</p>'
        +'<button class="empty-cta" type="button" id="reviewEmptyAction">'+(reviewFilter==="pending"?"查看全部":"✦ 体验 AI 批改")+'</button></div>';
      elem("reviewEmptyAction").addEventListener("click",function(){if(reviewFilter==="pending"){reviewFilter="all";paintComments();}else runMockReview();});
      scheduleHighlights();
      return;
    }
    visible.forEach(function(c){
      var anchor=getUniqueAnchor(c);
      var card=document.createElement("article");
      card.className="comment-card"+(c.id===selectedCommentId?" selected":"")+(c.status!=="pending"?" resolved":"");
      card.dataset.commentId=c.id;
      card.tabIndex=0;
      card.setAttribute("aria-label",(c.author==="AI"?"AI 批改结果":"人工批注")+"："+c.comment);
      var avatar=c.author==="AI"?"✦":"T";
      var tag=c.severity==="important"?"需关注":"可优化";
      var head='<div class="card-heading"><div class="review-avatar '+(c.author==="AI"?"":"human")+'">'+avatar+'</div>'
        +'<span class="card-author">'+(c.author==="AI"?"AI 批改结果":"我的批注")+'</span>'
        +(c.author==="AI"?'<span class="card-severity '+(c.severity==="important"?"":"suggestion")+'">'+tag+'</span>':'')+'</div>';
      var anchorNote=anchor.state==="ok"?"":'<div class="orphan-note">原文位置'+(anchor.state==="ambiguous"?"存在重复，无法确定":anchor.state==="missing"?"不存在":"已变化，请重新定位")+'；不会自动修改文字。</div>';
      var quote='<div class="comment-quote">“'+escapeHTML(c.quote)+'”</div>';
      var copy='<p class="comment-copy">'+escapeHTML(c.comment)+'</p>';
      var hasReplacement=c.replacement!==undefined && c.replacement!=="";
      var decision="",archive="",actions="";
      if(c.status==="pending"){
        decision='<section class="review-decision" aria-label="待人工确认的批改内容">'
          +'<div class="replacement-label"><span class="decision-dot" aria-hidden="true"></span>'
          +(hasReplacement?"待确认修改":"待处理批改")+'</div>'
          +(hasReplacement
            ?'<div class="replacement-text">'+escapeHTML(c.replacement)+'</div>'
            :'<div class="decision-hint">请确认这条批改意见是否已处理。</div>')
          +'<div class="comment-actions">'
          +(hasReplacement
            ?'<button type="button" class="accept" data-comment-action="accept" '+(anchor.state!=="ok"?"disabled":"")+'>✓ 接受修改</button>'
            :'<button type="button" class="accept resolve" data-comment-action="resolve">✓ 标记已处理</button>')
          +'<button type="button" class="ignore" data-comment-action="ignore">忽略</button></div></section>';
      }else{
        if(hasReplacement)archive='<div class="replacement-archive"><div class="replacement-label">原候选修改</div><div class="replacement-text">'+escapeHTML(c.replacement)+'</div></div>';
        actions='<div class="comment-status">'+(c.status==="accepted"?"✓ 已接受修改":c.status==="resolved"?"✓ 已处理":"已忽略")
          +' · <button type="button" class="text-action" data-comment-action="restore">恢复待处理</button></div>';
      }
      card.innerHTML=head+anchorNote+quote+copy+decision+archive+actions;
      card.addEventListener("mouseenter",function(){hoveredCommentId=c.id;scheduleRelations();});
      card.addEventListener("mouseleave",function(){hoveredCommentId=null;scheduleRelations();});
      card.addEventListener("click",function(event){
        if(event.target.closest("[data-comment-action]"))return;
        activateComment(c.id);
      });
      card.addEventListener("keydown",function(event){
        if(event.key==="Enter" && event.target===card){event.preventDefault();activateComment(c.id);}
      });
      card.querySelectorAll("[data-comment-action]").forEach(function(btn){
        btn.addEventListener("click",function(event){
          event.stopPropagation();
          applyCommentAction(c.id,btn.dataset.commentAction);
        });
      });
      commentsView.appendChild(card);
    });
    scheduleHighlights();
  }
  function activateComment(id){
    selectedCommentId=id;
    paintComments();
    var c=currentComments().find(function(x){return x.id===id;});
    if(!c)return;
    var node=query('.doc-block[data-block-id="'+c.block_id+'"]');
    if(node)node.scrollIntoView({behavior:"smooth",block:"center"});
    var card=query('.comment-card[data-comment-id="'+id+'"]');
    if(card)card.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  function applyCommentAction(id,action){
    var c=currentComments().find(function(x){return x.id===id;});
    if(!c)return;
    if(action==="accept"){
      var matched=getUniqueAnchor(c);
      if(matched.state!=="ok"){notify("原文已变化或有重复，无法自动应用建议");paintComments();return;}
      if(c.replacement===undefined){notify("这条批注没有候选修改");return;}
      recordBefore();
      var block=getBlock(c.block_id);
      block.text=block.text.slice(0,matched.start)+c.replacement+block.text.slice(matched.end);
      c.status="accepted";
      state.approved[documentTab()]=false;
      state.revisions[documentTab()]++;
      selectedCommentId=null;
      paintAll();
      saveSoon();
      notify("已应用建议，可以撤销");
    }else{
      recordBefore();
      c.status=action==="restore"?"pending":action==="resolve"?"resolved":"ignored";
      paintComments();
      saveSoon();
      notify(action==="restore"?"已恢复待处理":action==="resolve"?"批注已处理":"已忽略该建议");
    }
  }

  function selectionFromWindow(){
    var sel=window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount)return null;
    var range=sel.getRangeAt(0);
    var startEl=(range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer:range.startContainer.parentElement);
    var endEl=(range.endContainer.nodeType===Node.ELEMENT_NODE?range.endContainer:range.endContainer.parentElement);
    if(!startEl||!endEl||!startEl.closest||!endEl.closest)return null;
    var startBlock=startEl.closest(".block-editable"),endBlock=endEl.closest(".block-editable");
    if(!startBlock || !endBlock || startBlock!==endBlock)return null;
    var before=document.createRange();
    before.selectNodeContents(startBlock);
    try {before.setEnd(range.startContainer,range.startOffset);}catch(error){return null;}
    var start=before.toString().length,quote=sel.toString();
    var source=getBlock(startBlock.dataset.blockId);
    if(!source || quote.trim().length===0 || source.text.slice(start,start+quote.length)!==quote)return null;
    return {blockId:source.id,quote:quote,start:start,end:start+quote.length,rect:range.getBoundingClientRect()};
  }
  function captureSelection(){
    if(state.activeTab==="generate"||!composer.hidden)return;
    var next=selectionFromWindow();
    if(!next){selectionToolbar.hidden=true;return;}
    currentSelection=next;
    var rect=next.rect;
    var width=138;
    selectionToolbar.style.left=Math.max(10,Math.min(window.innerWidth-width-10,rect.left+rect.width/2-width/2))+"px";
    selectionToolbar.style.top=Math.max(12,rect.top-50)+"px";
    selectionToolbar.hidden=false;
  }
  function startComment(){
    if(state.activeTab==="generate"){notify("请先进入剧本或分镜");return;}
    var sel=selectionFromWindow() || currentSelection;
    if(!sel){notify("请先在正文中选中需要批注的文字");return;}
    var block=getBlock(sel.blockId);
    if(!block || block.text.slice(sel.start,sel.end)!==sel.quote){notify("所选文字已变化，请重新选择");return;}
    composerSelection=Object.assign({},sel);
    selectionToolbar.hidden=true;
    composer.hidden=false;
    elem("composerQuote").textContent="“"+sel.quote+"”";
    elem("commentInput").value="";
    var rect=sel.rect;
    var width=Math.min(314,window.innerWidth-24);
    var height=235;
    var left=Math.max(12,Math.min(window.innerWidth-width-12,rect.left));
    var below=rect.bottom+12;
    var top=below+height<window.innerHeight-8?below:Math.max(12,rect.top-height-12);
    composer.style.left=left+"px";
    composer.style.top=top+"px";
    elem("commentInput").focus();
    scheduleHighlights();
  }
  function closeComposer(){
    composer.hidden=true;
    composerSelection=null;
    selectionToolbar.hidden=true;
    scheduleHighlights();
  }
  function submitComment(){
    var text=elem("commentInput").value.trim();
    if(!text){notify("请填写批注内容");return;}
    if(!composerSelection){notify("请重新选择需要批注的文字");return;}
    var sel=composerSelection,block=getBlock(sel.blockId);
    if(!block || block.text.slice(sel.start,sel.end)!==sel.quote){
      notify("原文已变化，请重新选择文字");
      return;
    }
    recordBefore();
    var c={id:newId(),author:"human",block_id:sel.blockId,quote:sel.quote,
      comment:text,severity:"suggestion",status:"pending",source_revision:currentRevision()};
    currentComments().push(c);
    selectedCommentId=c.id;
    closeComposer();
    setReviewOpen(true);
    paintComments();
    saveSoon();
    notify("批注已添加");
  }

  var scriptSuggestions=[
    {block_id:"sc01-line1",quote:"我们没有别的选择了。",comment:"这句台词比较抽象。如果通过眼前的生存压力表达选择的代价，可能更符合这个场景的情绪。",replacement:"不这么做，明天我们连水都没有。",severity:"important"},
    {block_id:"sc01-action1",quote:"灯光不太稳定。",comment:"可以把环境变化与人物当前的处境建立一点联系，避免它只是气氛描写。",replacement:"灯管忽明忽暗，特瑞下意识地看了一眼电量表。",severity:"suggestion"},
    {block_id:"sc01-line2",quote:"如果每一次都这样，我们到底是在修什么？",comment:"小七的提问有角色关系张力。可以考虑保留，不必因为信息没有立即解释清楚就删掉。",severity:"suggestion"}
  ];
  var storyboardSuggestions=[
    {block_id:"shot-02",quote:"镜头快速推近特瑞的面部。",comment:"上一句已经定义为中景，突然快速推近容易抢走动作的叙事重心。可以用更克制的运动表现压力。",replacement:"镜头缓慢推近，停在特瑞专注的侧脸。",severity:"important"},
    {block_id:"shot-03",quote:"镜头没有交代它与特瑞的相对位置",comment:"角色进入方向和双方空间关系不清楚，后续对话可能出现视线不匹配。建议先建立明确位置。",replacement:"镜头保留小七与特瑞的相对位置",severity:"important"},
    {block_id:"shot-05",quote:"画面与上一镜头之间的动作衔接尚不明确。",comment:"这属于剪接叙事与生成参考的交叉问题。建议说明是独立转场还是需要上一片段尾帧；不要仅凭镜头排列推断续接。",severity:"suggestion"}
  ];

  function runMockReview(){
    if(reviewing)return;
    if(state.activeTab==="generate"){notify("生成阶段暂不支持文本审查");return;}
    var tab=documentTab(),revision=currentRevision();
    reviewing=true;
    elem("aiReviewButton").disabled=true;
    elem("aiReviewLabel").textContent="审查中…";
    selectionToolbar.hidden=true;
    notify("正在模拟 AI 批改（不会调用付费 API）");
    window.setTimeout(function(){
      reviewing=false;
      elem("aiReviewButton").disabled=false;
      elem("aiReviewLabel").textContent="AI 批改全文";
      if(documentTab()!==tab || currentRevision()!==revision){
        notify("审查期间文档发生变化，结果未应用；可重新审查");
        return;
      }
      var candidates=tab==="script"?scriptSuggestions:storyboardSuggestions;
      var addition=[];
      candidates.forEach(function(s){
        var block=getBlock(s.block_id);
        if(!block || !block.text.includes(s.quote) || block.text.indexOf(s.quote)!==block.text.lastIndexOf(s.quote))return;
        var duplicate=currentComments().some(function(c){return c.block_id===s.block_id && c.quote===s.quote;});
        if(!duplicate)addition.push(Object.assign({},s,{
          id:newId(),author:"AI",status:"pending",source_revision:revision
        }));
      });
      if(!addition.length){notify("没有新增的模拟批改结果（修改示例正文或重置后可重新体验）");return;}
      recordBefore();
      state.comments[tab].push.apply(state.comments[tab],addition);
      state.summaries[tab]=tab==="script"
        ?"模拟发现 "+addition.length+" 条可讨论的局部问题。优先保留人物表达，避免机械润色。"
        :"模拟发现 "+addition.length+" 条镜头建议。优先检查空间关系、镜头意图和衔接合理性。";
      reviewFilter="all";
      paintComments();
      setReviewOpen(true);
      saveSoon();
      notify("已添加 "+addition.length+" 条 AI 批注，原文保持不变");
    },750);
  }
  function approveCurrent(){
    if(state.activeTab==="generate")return;
    var tab=documentTab();
    if(state.approved[tab]){notify("当前稿件已批准");return;}
    var active=pendingCount();
    if(active>0 && !window.confirm("还有 "+active+" 条待处理批注，仍然批准当前稿件吗？"))return;
    recordBefore();
    state.approved[tab]=true;
    paintNavigation();
    saveSoon();
    notify("已批准当前稿件（仅本地演示状态）");
  }
  function paintAll(){
    paintNavigation();
    paintDocument();
    paintComments();
    // Existing review results remain docked at the right on desktop, including after reload.
    setReviewOpen(state.activeTab!=="generate"&&currentComments().length>0&&window.innerWidth>850);
    updateUndoButtons();
    scheduleHighlights();
    scheduleRelations();
  }

  /* topbar, stage and editor actions */
  query(".episode.active").addEventListener("click",function(){changeTab("script");});
  all("[data-tab]").forEach(function(btn){btn.addEventListener("click",function(){changeTab(btn.dataset.tab);});});
  all("[data-filter]").forEach(function(btn){btn.addEventListener("click",function(){reviewFilter=btn.dataset.filter;paintComments();});});
  elem("aiReviewButton").addEventListener("click",runMockReview);
  elem("approveButton").addEventListener("click",approveCurrent);
  elem("selectionComment").addEventListener("click",startComment);
  elem("openReview").addEventListener("click",function(){setReviewOpen(!elem("reviewSidebar").classList.contains("open"));});
  elem("toggleFocus").addEventListener("click",function(){
    state.layout=state.layout==="full"?"focus":"full";
    paintNavigation();
    saveSoon();
  });
  elem("undoButton").addEventListener("click",undo);
  elem("redoButton").addEventListener("click",redo);
  elem("submitComment").addEventListener("click",submitComment);
  elem("cancelComment").addEventListener("click",closeComposer);
  elem("commentInput").addEventListener("keydown",function(e){
    if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();submitComment();}
  });
  elem("closeReview").addEventListener("click",function(){setReviewOpen(false);});
  document.addEventListener("pointerdown",function(event){
    // The review results are persistent. Only the add-comment composer closes outside.
    if(composer.hidden)return;
    if(event.target.closest("#commentComposer, #selectionToolbar"))return;
    closeComposer();
  });
  elem("resetDemo").addEventListener("click",function(){
    if(!window.confirm("将清除当前浏览器里保存的 Demo 编辑、批注与修订内容，确认重置吗？"))return;
    localStorage.removeItem(STORAGE_KEY);
    state=initialState();
    undoHistory=[];redoHistory=[];
    currentSelection=null;composerSelection=null;selectedCommentId=null;reviewFilter="all";
    setReviewOpen(false);
    paintAll();saveNow();notify("已恢复初始示例");
  });
  elem("openAssets").addEventListener("click",function(){elem("assetDrawer").hidden=false;elem("assetBackdrop").hidden=false;});
  function closeAssets(){elem("assetDrawer").hidden=true;elem("assetBackdrop").hidden=true;}
  elem("closeAssets").addEventListener("click",closeAssets);
  elem("assetBackdrop").addEventListener("click",closeAssets);
  document.addEventListener("mouseup",function(e){
    if(e.target.closest(".block-editable"))window.setTimeout(captureSelection,0);
    else if(!e.target.closest("#selectionToolbar")&&!e.target.closest("#commentComposer"))selectionToolbar.hidden=true;
  });
  document.addEventListener("keyup",function(e){
    if(e.target.closest && e.target.closest(".block-editable"))window.setTimeout(captureSelection,0);
  });
  elem("pageScroller").addEventListener("scroll",scheduleRelations,{passive:true});
  commentsView.addEventListener("scroll",scheduleRelations,{passive:true});
  window.addEventListener("resize",scheduleRelations);
  if(window.ResizeObserver){new ResizeObserver(scheduleRelations).observe(elem("workArea"));}
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){selectionToolbar.hidden=true;closeAssets();if(!composer.hidden)closeComposer();}
    if((e.ctrlKey||e.metaKey) && !e.altKey){
      var tag=(e.target.tagName||"").toLowerCase();
      var editable=!!e.target.closest("[contenteditable='true']")||tag==="textarea";
      if(!editable && e.key.toLowerCase()==="z"){e.preventDefault();if(e.shiftKey)redo();else undo();}
      if(!editable && e.key.toLowerCase()==="y"){e.preventDefault();redo();}
    }
  });

  paintAll();
  saveNow();
})();