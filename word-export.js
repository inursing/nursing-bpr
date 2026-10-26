/* Text and tables directly to OOXML. No canvas or remote conversion service. */
(() => {
  const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const crc=b=>{let c=0xffffffff;for(const n of b){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  function zip(files){
    const enc=new TextEncoder(),chunks=[],central=[];let offset=0,size=0;
    for(const [name,text] of Object.entries(files)){
      const n=enc.encode(name),data=enc.encode(text),sum=crc(data),h=new Uint8Array(30+n.length),v=new DataView(h.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);h.set(n,30);
      const c=new Uint8Array(46+n.length),w=new DataView(c.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,sum,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,n.length,true);w.setUint32(42,offset,true);c.set(n,46);
      chunks.push(h,data);central.push(c);offset+=h.length+data.length;size+=c.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
    return new Blob([...chunks,...central,end],{type:MIME});
  }
  const run=(text,bold=false)=>'<w:r><w:rPr>'+(bold?'<w:b/>':'')+'</w:rPr><w:t xml:space="preserve">'+esc(text)+'</w:t></w:r>';
  function inline(n){
    if(n.nodeType===3)return run(n.textContent);
    if(n.nodeType!==1)return '';
    if(n.tagName==='BR')return '<w:r><w:br/></w:r>';
    if(['SCRIPT','STYLE','BUTTON'].includes(n.tagName))return '';
    if(['B','STRONG'].includes(n.tagName))return run(n.textContent,true);
    return [...n.childNodes].map(inline).join('');
  }
  const paragraph=(content,style='')=>'<w:p><w:pPr>'+(style?'<w:pStyle w:val="'+style+'"/>':'')+'<w:spacing w:after="100"/></w:pPr>'+content+'</w:p>';
  function table(t){
    const rows=[...t.rows],cols=Math.max(1,...rows.map(r=>[...r.cells].reduce((a,c)=>a+(c.colSpan||1),0))),width=Math.floor(14500/cols);
    return '<w:tbl><w:tblPr><w:tblW w:w="14500" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(x=>'<w:'+x+' w:val="single" w:sz="4" w:color="B9BCC8"/>').join('')+'</w:tblBorders></w:tblPr><w:tblGrid>'+Array.from({length:cols},()=>'<w:gridCol w:w="'+width+'"/>').join('')+'</w:tblGrid>'+rows.map(r=>{
      const header=[...r.cells].every(c=>c.tagName==='TH');
      return '<w:tr>'+(header?'<w:trPr><w:tblHeader/></w:trPr>':'')+[...r.cells].map(c=>'<w:tc><w:tcPr><w:tcW w:w="'+width*(c.colSpan||1)+'" w:type="dxa"/>'+(c.colSpan>1?'<w:gridSpan w:val="'+c.colSpan+'"/>':'')+(header?'<w:shd w:fill="EDEDF5"/>':'')+'</w:tcPr>'+paragraph(inline(c))+'</w:tc>').join('')+'</w:tr>';
    }).join('')+'</w:tbl>'+paragraph('');
  }
  function blocks(root){
    let result='',pending='';const flush=()=>{if(pending.trim())result+=paragraph(pending);pending='';};
    for(const n of root.childNodes){
      if(n.nodeType===1&&['SCRIPT','STYLE','BUTTON'].includes(n.tagName))continue;
      if(n.nodeType===1&&n.tagName==='TABLE'){flush();result+=table(n);}
      else if(n.nodeType===1&&/^H[1-6]$/.test(n.tagName)){flush();result+=paragraph(inline(n),'Heading1');}
      else if(n.nodeType===1&&['DIV','SECTION','P','UL','OL','LI'].includes(n.tagName)){flush();result+=blocks(n);}
      else pending+=inline(n);
    }flush();return result;
  }
  function create(title,html){
    const root=document.createElement('div');root.innerHTML=html;
    const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const body=paragraph(run(title),'Title')+blocks(root)+'<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="1100" w:bottom="850" w:left="1100"/></w:sectPr>';
    return zip({
      '[Content_Types].xml':xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      '_rels/.rels':xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml':xml+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>',
      'word/_rels/document.xml.rels':xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'word/styles.xml':xml+'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft JhengHei"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>'
    });
  }
  window.WordExport={create,MIME};
})();
