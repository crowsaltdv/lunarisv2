import times from "./times.js";
import createCanvas from "./create-canvas.js";
import {random, chance} from "./random.js?v=3";

let dropSize=64;
const Drop={
  x:0,
  y:0,
  r:0,
  spreadX:0,
  spreadY:0,
  momentum:0,
  momentumX:0,
  lastSpawn:0,
  nextSpawn:0,
  parent:null,
  isNew:true,
  killed:false,
  shrink:0,
}
const defaultOptions={
  minR:10,
  maxR:40,
  maxDrops:900,
  rainChance:0.3,
  rainLimit:3,
  dropletsRate:50,
  dropletsSize:[2,4],
  dropletsCleaningRadiusMultiplier:0.43,
  raining:true,
  globalTimeScale:1,
  trailRate:1,
  autoShrink:true,
  spawnArea:[-0.1,0.95],
  trailScaleRange:[0.2,0.5],
  collisionRadius:0.65,
  collisionRadiusIncrease:0.01,
  dropFallMultiplier:1,
  collisionBoostMultiplier:0.05,
  collisionBoost:1,
  density:1,
  maxTimeScale:3,
}

// The 255 drop sprites only depend on the two drop images, so one sheet is shared by every Raindrops
// (they are rebuilt on each resize / quality change). All sprites live on one canvas, which lets the
// browser draw a whole frame of drops from a single texture instead of switching between 255 of them.
const SPRITES=255;
const SHEET_COLS=16;
let sheet=null;
function dropSheet(dropAlpha,dropColor){
  if(sheet&&sheet.alpha===dropAlpha&&sheet.color===dropColor) return sheet.canvas;
  const canvas=createCanvas(SHEET_COLS*dropSize,SHEET_COLS*dropSize);
  const ctx=canvas.getContext('2d');
  const buffer=createCanvas(dropSize,dropSize);
  const bctx=buffer.getContext('2d');
  const one=createCanvas(dropSize,dropSize);
  const octx=one.getContext('2d');
  for(let i=0;i<SPRITES;i++){
    bctx.clearRect(0,0,dropSize,dropSize);
    // color
    bctx.globalCompositeOperation="source-over";
    bctx.drawImage(dropColor,0,0,dropSize,dropSize);
    // blue overlay, for depth
    bctx.globalCompositeOperation="screen";
    bctx.fillStyle="rgba(0,0,"+i+",1)";
    bctx.fillRect(0,0,dropSize,dropSize);
    // alpha
    octx.clearRect(0,0,dropSize,dropSize);
    octx.globalCompositeOperation="source-over";
    octx.drawImage(dropAlpha,0,0,dropSize,dropSize);
    octx.globalCompositeOperation="source-in";
    octx.drawImage(buffer,0,0,dropSize,dropSize);
    ctx.drawImage(one,(i%SHEET_COLS)*dropSize,Math.floor(i/SHEET_COLS)*dropSize);
  }
  sheet={alpha:dropAlpha,color:dropColor,canvas};
  return canvas;
}

function Raindrops(width,height,scale,dropAlpha,dropColor,options={}){
  this.width=width;
  this.height=height;
  this.scale=scale;
  this.dropAlpha=dropAlpha;
  this.dropColor=dropColor;
  this.options=Object.assign({},defaultOptions,options);
  this.init();
}
Raindrops.prototype={
  dropColor:null,
  dropAlpha:null,
  canvas:null,
  ctx:null,
  width:0,
  height:0,
  scale:0,
  dropletsPixelDensity:1,
  droplets:null,
  dropletsCtx:null,
  dropletsCounter:0,
  drops:null,
  dropsSheet:null,
  scratch:null,
  clearDropletsGfx:null,
  textureCleaningIterations:0,
  lastRender:null,

  options:null,

  init(){
    this.canvas = createCanvas(this.width,this.height);
    this.ctx = this.canvas.getContext('2d');

    this.droplets = createCanvas(this.width*this.dropletsPixelDensity,this.height*this.dropletsPixelDensity);
    this.dropletsCtx = this.droplets.getContext('2d');

    this.drops=[];
    this.scratch={x:0,y:0,r:0,spreadX:0,spreadY:0};

    this.renderDropsGfx();

    this.update();
  },
  get deltaR(){
    return this.options.maxR-this.options.minR;
  },
  // the screen's area in CSS pixels, whatever resolution the canvas is drawn at
  get area(){
    return (this.width/this.scale)*(this.height/this.scale);
  },
  get areaMultiplier(){
    return Math.sqrt(this.area/(1024*768))*this.options.density;
  },
  drawDroplet(x,y,r){
    const d=this.scratch;
    d.x=x*this.dropletsPixelDensity;
    d.y=y*this.dropletsPixelDensity;
    d.r=r*this.dropletsPixelDensity;
    this.drawDrop(this.dropletsCtx,d);
  },

  renderDropsGfx(){
    this.dropsSheet=dropSheet(this.dropAlpha,this.dropColor);

    // create circle that will be used as a brush to remove droplets
    this.clearDropletsGfx=createCanvas(128,128);
    let clearDropletsCtx=this.clearDropletsGfx.getContext("2d");
    clearDropletsCtx.fillStyle="#000";
    clearDropletsCtx.beginPath();
    clearDropletsCtx.arc(64,64,64,0,Math.PI*2);
    clearDropletsCtx.fill();
  },
  drawDrop(ctx,drop){
    let x=drop.x;
    let y=drop.y;
    let r=drop.r;
    let spreadX=drop.spreadX;
    let spreadY=drop.spreadY;

    let scaleX=1;
    let scaleY=1.5;

    let d=Math.max(0,Math.min(1,((r-this.options.minR)/(this.deltaR))*0.9));
    d*=1/(((drop.spreadX+drop.spreadY)*0.5)+1);

    ctx.globalAlpha=1;
    ctx.globalCompositeOperation="source-over";

    d=Math.floor(d*(SPRITES-1));
    ctx.drawImage(
      this.dropsSheet,
      (d%SHEET_COLS)*dropSize,
      Math.floor(d/SHEET_COLS)*dropSize,
      dropSize,
      dropSize,
      (x-(r*scaleX*(spreadX+1)))*this.scale,
      (y-(r*scaleY*(spreadY+1)))*this.scale,
      (r*2*scaleX*(spreadX+1))*this.scale,
      (r*2*scaleY*(spreadY+1))*this.scale
    );
  },
  clearDroplets(x,y,r=30){
    let ctx=this.dropletsCtx;
    ctx.globalCompositeOperation="destination-out";
    ctx.drawImage(
      this.clearDropletsGfx,
      (x-r)*this.dropletsPixelDensity*this.scale,
      (y-r)*this.dropletsPixelDensity*this.scale,
      (r*2)*this.dropletsPixelDensity*this.scale,
      (r*2)*this.dropletsPixelDensity*this.scale*1.5
    )
  },
  clearCanvas(){
    this.ctx.clearRect(0,0,this.width,this.height);
  },
  createDrop(options){
    if(this.drops.length >= this.options.maxDrops*this.areaMultiplier) return null;

    return Object.assign(Object.create(Drop),options);
  },
  addDrop(drop){
    if(this.drops.length >= this.options.maxDrops*this.areaMultiplier || drop==null) return false;

    this.drops.push(drop);
    return true;
  },
  updateRain(timeScale){
    let rainDrops=[];
    if(this.options.raining){
      let limit=this.options.rainLimit*timeScale*this.areaMultiplier;
      let count=0;
      while(chance(this.options.rainChance*timeScale*this.areaMultiplier) && count<limit){
        count++;
        let r=random(this.options.minR,this.options.maxR,(n)=>{
          return Math.pow(n,3);
        });
        let rainDrop=this.createDrop({
          x:random(this.width/this.scale),
          y:random((this.height/this.scale)*this.options.spawnArea[0],(this.height/this.scale)*this.options.spawnArea[1]),
          r:r,
          momentum:1+((r-this.options.minR)*0.1)+random(2),
          spreadX:1.5,
          spreadY:1.5,
        });
        if(rainDrop!=null){
          rainDrops.push(rainDrop);
        }
      }
    }
    return rainDrops;
  },
  clearDrops(){
    this.drops.forEach((drop)=>{
      setTimeout(()=>{
        drop.shrink=0.1+(random(0.5));
      },random(1200))
    })
    this.clearTexture();
  },
  clearTexture(){
    this.textureCleaningIterations=50;
  },
  updateDroplets(timeScale){
    if(this.textureCleaningIterations>0){
      this.textureCleaningIterations-=1*timeScale;
      this.dropletsCtx.globalCompositeOperation="destination-out";
      this.dropletsCtx.fillStyle="rgba(0,0,0,"+(0.05*timeScale)+")";
      this.dropletsCtx.fillRect(0,0,
        this.width*this.dropletsPixelDensity,this.height*this.dropletsPixelDensity);
    }
    if(this.options.raining){
      this.dropletsCounter+=this.options.dropletsRate*timeScale*this.areaMultiplier;
      times(this.dropletsCounter,(i)=>{
        this.dropletsCounter--;
        this.drawDroplet(
          random(this.width/this.scale),
          random(this.height/this.scale),
          random(...this.options.dropletsSize,(n)=>{
            return n*n;
          })
        )
      });
    }
    this.ctx.drawImage(this.droplets,0,0,this.width,this.height);
  },
  updateDrops(timeScale){
    let newDrops=[];

    this.updateDroplets(timeScale);
    let rainDrops=this.updateRain(timeScale);
    newDrops=newDrops.concat(rainDrops);

    const rowWidth=this.width/this.scale;
    this.drops.sort((a,b)=>{
      let va=(a.y*rowWidth)+a.x;
      let vb=(b.y*rowWidth)+b.x;
      return va>vb?1:va==vb?0:-1;
    });

    this.drops.forEach(function(drop,i){
      if(!drop.killed){
        // update gravity
        // (chance of drops "creeping down")
        if(chance((drop.r-(this.options.minR*this.options.dropFallMultiplier)) * (0.1/this.deltaR) * timeScale)){
          drop.momentum = Math.min(drop.momentum + random((drop.r/this.options.maxR)*4), 60); // (60: merged drops already top out at 40; this keeps a freak drop from accelerating without limit)
        }
        // clean small drops
        if(this.options.autoShrink && drop.r<=this.options.minR && chance(0.05*timeScale)){
          drop.shrink+=0.01;
        }
        //update shrinkage
        drop.r -= drop.shrink*timeScale;
        if(drop.r<=0) drop.killed=true;

        // update trails
        if(this.options.raining){
          drop.lastSpawn+=drop.momentum*timeScale*this.options.trailRate;
          if(drop.lastSpawn>drop.nextSpawn){
            let trailDrop=this.createDrop({
              x:drop.x+(random(-drop.r,drop.r)*0.1),
              y:drop.y-(drop.r*0.01),
              r:drop.r*random(...this.options.trailScaleRange),
              spreadY:drop.momentum*0.1,
              parent:drop,
            });

            if(trailDrop!=null){
              newDrops.push(trailDrop);

              drop.r*=0.97; // per trail droplet, not per unit of time: trails are laid down by distance travelled, so scaling this by the step size made drops lose less mass at high frame rates, grow, speed up and run away
              drop.lastSpawn=0;
              drop.nextSpawn=random(this.options.minR,this.options.maxR)-(drop.momentum*2*this.options.trailRate)+(this.options.maxR-drop.r);
            }
          }
        }

        //normalize spread
        drop.spreadX*=Math.pow(0.4,timeScale);
        drop.spreadY*=Math.pow(0.7,timeScale);

        //update position
        let moved=drop.momentum>0;
        if(moved && !drop.killed){
          // scaled by the elapsed time, so drops fall at the same speed at 30, 60 or 144 frames a second
          drop.y+=drop.momentum*timeScale;
          drop.x+=drop.momentumX*timeScale;
          if(drop.y>(this.height/this.scale)+drop.r){
            drop.killed=true;
          }
        }

        // collision
        let checkCollision=(moved || drop.isNew) && !drop.killed;
        drop.isNew=false;

        if(checkCollision){
          // the next 69 drops in the sorted list (a plain loop: no copy of the list per drop)
          const list=this.drops;
          const end=Math.min(list.length,i+70);
          for(let j=i+1;j<end;j++){
            const drop2=list[j];
            //basic check
            if(
              drop != drop2 &&
              drop.r > drop2.r &&
              drop.parent != drop2 &&
              drop2.parent != drop &&
              !drop2.killed
            ){
              let dx=drop2.x-drop.x;
              let dy=drop2.y-drop.y;
              var d=Math.sqrt((dx*dx)+(dy*dy));
              //if it's within acceptable distance
              if(d<(drop.r+drop2.r)*(this.options.collisionRadius+(drop.momentum*this.options.collisionRadiusIncrease*timeScale))){
                let pi=Math.PI;
                let r1=drop.r;
                let r2=drop2.r;
                let a1=pi*(r1*r1);
                let a2=pi*(r2*r2);
                let targetR=Math.sqrt((a1+(a2*0.8))/pi);
                if(targetR>this.options.maxR*2){ // (the original compared with this.maxR, which doesn't exist, so merged drops never had a size limit)
                  targetR=this.options.maxR*2;
                }
                drop.r=targetR;
                drop.momentumX+=dx*0.1;
                drop.spreadX=0;
                drop.spreadY=0;
                drop2.killed=true;
                drop.momentum=Math.max(drop2.momentum,Math.min(40,drop.momentum+(targetR*this.options.collisionBoostMultiplier)+this.options.collisionBoost));
              }
            }
          }
        }

        //slowdown momentum
        drop.momentum-=Math.max(1,(this.options.minR*0.5)-drop.momentum)*0.1*timeScale;
        if(drop.momentum<0) drop.momentum=0;
        drop.momentumX*=Math.pow(0.7,timeScale);


        if(!drop.killed){
          newDrops.push(drop);
          if(moved && this.options.dropletsRate>0) this.clearDroplets(drop.x,drop.y,drop.r*this.options.dropletsCleaningRadiusMultiplier);
          this.drawDrop(this.ctx, drop);
        }

      }
    },this);

    this.drops = newDrops;
  },
  update(){
    this.clearCanvas();

    let now=Date.now();
    if(this.lastRender==null) this.lastRender=now;
    let deltaT=now-this.lastRender;
    let timeScale=deltaT/((1/60)*1000);
    if(!(timeScale>=0)) timeScale=0; // a clock that stepped backwards (or NaN) must not run the simulation in reverse
    else if(timeScale>this.options.maxTimeScale) timeScale=this.options.maxTimeScale;
    timeScale*=this.options.globalTimeScale;
    this.lastRender=now;

    this.updateDrops(timeScale);
  },
  // one step of the simulation per call: the caller owns the frame loop (see lunaris-rain.js)
  // call after a pause so the first step doesn't see the whole pause as elapsed time
  resume(){this.lastRender=null}
}

export default Raindrops;
