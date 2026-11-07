import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const out = path.resolve("artifacts/api-server/web");
const hex = (value) => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16), 255];
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
const crc32 = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const name = Buffer.from(type); const body = Buffer.concat([name, data]); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([size, body, crc]); };

function image(width, height, color = "#090d13") {
  const pixels = Buffer.alloc(width * height * 4); const c = hex(color);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(c, i);
  const set = (x, y, color) => { if (x < 0 || y < 0 || x >= width || y >= height) return; pixels.set(color, (Math.floor(y) * width + Math.floor(x)) * 4); };
  const rect = (x, y, w, h, color) => { const c2 = typeof color === "string" ? hex(color) : color; for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) set(xx, yy, c2); };
  const circle = (cx, cy, radius, color, inner = 0) => { const c2 = typeof color === "string" ? hex(color) : color; for (let y = Math.floor(cy-radius); y <= cy+radius; y++) for (let x = Math.floor(cx-radius); x <= cx+radius; x++) { const d = Math.hypot(x-cx,y-cy); if (d <= radius && d >= inner) set(x,y,c2); } };
  const line = (x1,y1,x2,y2,r,color) => { const steps = Math.ceil(Math.hypot(x2-x1,y2-y1)); for(let i=0;i<=steps;i++){const t=i/steps;circle(x1+(x2-x1)*t,y1+(y2-y1)*t,r,color);} };
  return { width,height,pixels,rect,circle,line };
}

function drawLogo(size, fullBackground = false) {
  const im = image(size,size,"#101b23"); const s=size/64;
  if (!fullBackground) {
    const base=im.pixels.slice();
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const cornerX=Math.min(x,size-1-x), cornerY=Math.min(y,size-1-y);
      if(cornerX<Math.ceil(size*.18)&&cornerY<Math.ceil(size*.18)&&Math.hypot(Math.ceil(size*.18)-cornerX,Math.ceil(size*.18)-cornerY)>Math.ceil(size*.18)) im.pixels.fill(0,(y*size+x)*4,(y*size+x)*4+4);
    }
    void base;
  }
  im.circle(25*s,40*s,14*s,"#80f0c0");
  im.circle(25*s,40*s,7*s,"#101b23");
  im.rect(37*s,12*s,9*s,40*s,"#80f0c0");
  im.circle(53*s,15*s,2*s,"#d8fff0");
  im.rect(52*s,11*s,2*s,8*s,"#d8fff0");
  return im;
}

function encodePNG(im) {
  const rows=Buffer.alloc((im.width*4+1)*im.height);
  for(let y=0;y<im.height;y++) im.pixels.copy(rows,y*(im.width*4+1)+1,y*im.width*4,(y+1)*im.width*4);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(im.width,0);ihdr.writeUInt32BE(im.height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(rows,{level:9})),chunk("IEND",Buffer.alloc(0))]);
}

const glyphs={A:["01110","10001","10001","11111","10001","10001","10001"],B:["11110","10001","10001","11110","10001","10001","11110"],C:["01111","10000","10000","10000","10000","10000","01111"],D:["11110","10001","10001","10001","10001","10001","11110"],E:["11111","10000","10000","11110","10000","10000","11111"],F:["11111","10000","10000","11110","10000","10000","10000"],G:["01111","10000","10000","10111","10001","10001","01111"],H:["10001","10001","10001","11111","10001","10001","10001"],I:["11111","00100","00100","00100","00100","00100","11111"],L:["10000","10000","10000","10000","10000","10000","11111"],M:["10001","11011","10101","10101","10001","10001","10001"],N:["10001","11001","10101","10011","10001","10001","10001"],O:["01110","10001","10001","10001","10001","10001","01110"],R:["11110","10001","10001","11110","10100","10010","10001"],S:["01111","10000","10000","01110","00001","00001","11110"],T:["11111","00100","00100","00100","00100","00100","00100"],U:["10001","10001","10001","10001","10001","10001","01110"],V:["10001","10001","10001","10001","10001","01010","00100"],Y:["10001","10001","01010","00100","00100","00100","00100"]," ":["00000","00000","00000","00000","00000","00000","00000"]};
function drawText(im,text,x,y,scale,color){for(const char of text.toUpperCase()){const rows=glyphs[char]||glyphs[" "];for(let r=0;r<7;r++)for(let c=0;c<5;c++)if(rows[r][c]==="1")im.rect(x+c*scale,y+r*scale,scale-1,scale-1,color);x+=6*scale;}}
function drawOG(){const im=image(1200,630);for(let i=0;i<70;i++){const x=(i*197+31)%1200,y=(i*113+41)%630;im.circle(x,y,(i%3===0?2:1),i%4===0?"#80f0c0":"#354752");}im.circle(945,310,236,[20,43,49,255],220);im.circle(945,310,178,[21,47,48,255],170);im.circle(945,310,95,"#101b23");im.circle(930,370,55,"#80f0c0");im.circle(930,370,28,"#101b23");im.rect(970,250,36,180,"#80f0c0");im.circle(1048,244,7,"#d8fff0");drawText(im,"dea",118,245,20,"#80f0c0");drawText(im,"AMONG US ROUNDS ON DISCORD",120,410,5,"#edf5f7");drawText(im,"VOICE TOOLS  /  LOBBY CODES  /  ROUND FLOW",120,480,3,"#99aab5");im.line(120,540,1080,540,1,"#31414b");return im;}

await fs.mkdir(out,{recursive:true});
for(const size of [16,32,48,180,192,512]) await fs.writeFile(path.join(out,size===180?"apple-touch-icon.png":size===192?"icon-192.png":size===512?"icon-512.png":`favicon-${size}x${size}.png`),encodePNG(drawLogo(size,size===180||size===192||size===512)));
await fs.writeFile(path.join(out,"icon-512-maskable.png"),encodePNG(drawLogo(512,true)));
await fs.writeFile(path.join(out,"og-image.png"),encodePNG(drawOG()));
const icoSizes=[16,32,48], entries=icoSizes.map((size)=>encodePNG(drawLogo(size)));
const header=Buffer.alloc(6+16*entries.length);header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(entries.length,4);let offset=header.length;
entries.forEach((png,index)=>{const at=6+index*16;header[at]=icoSizes[index];header[at+1]=icoSizes[index];header[at+2]=0;header[at+3]=0;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;});
await fs.writeFile(path.join(out,"favicon.ico"),Buffer.concat([header,...entries]));
