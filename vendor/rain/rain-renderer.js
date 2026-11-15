import GL from "./gl-obj.js?v=3";
import createCanvas from "./create-canvas.js";
import {vertShader,fragShader} from "./shaders.js";

const defaultOptions={
  renderShadow:false,
  minRefraction:256,
  maxRefraction:512,
  brightness:1,
  alphaMultiply:20,
  alphaSubtract:5,
  parallaxBg:5,
  parallaxFg:20
}
// The caller owns the frame loop: draw() renders exactly one frame.
function RainRenderer(canvas,canvasLiquid, imageFg, imageBg, imageShine=null,options={}){

  this.canvas=canvas;
  this.canvasLiquid=canvasLiquid;
  this.imageShine=imageShine;
  this.imageFg=imageFg;
  this.imageBg=imageBg;
  this.options=Object.assign({},defaultOptions, options);
  this.init();
}

RainRenderer.prototype={
  canvas:null,
  gl:null,
  canvasLiquid:null,
  liquidW:0,
  liquidH:0,
  width:0,
  height:0,
  imageShine:"",
  imageFg:"",
  imageBg:"",
  textures:null,
  programWater:null,
  parallaxLoc:null,
  parallaxX:0,
  parallaxY:0,
  options:null,
  init(){
    this.width=this.canvas.width;
    this.height=this.canvas.height;
    // no antialiasing, depth or stencil: the whole picture is one full-screen quad, so they would only cost memory and bandwidth
    this.gl=new GL(this.canvas, {alpha:false,antialias:false,depth:false,stencil:false},vertShader,fragShader);
    let gl=this.gl;
    this.programWater=gl.program;

    gl.createUniform("1f","textureRatio",this.imageBg.width/this.imageBg.height);
    gl.createUniform("1i","renderShine",this.imageShine==null?false:true);
    gl.createUniform("1i","renderShadow",this.options.renderShadow);
    gl.createUniform("1f","brightness",this.options.brightness);
    gl.createUniform("1f","alphaMultiply",this.options.alphaMultiply);
    gl.createUniform("1f","alphaSubtract",this.options.alphaSubtract);
    this.applySize();

    gl.createTexture(null,0);

    this.textures=[
      {name:'textureShine', img:this.imageShine==null?createCanvas(2,2):this.imageShine},
      {name:'textureFg', img:this.imageFg},
      {name:'textureBg', img:this.imageBg}
    ];

    this.textures.forEach((texture,i)=>{
      gl.createTexture(texture.img,i+1);
      gl.createUniform("1i",texture.name,i+1);
    });

    this.parallaxLoc=gl.uniformLocation("parallax");
    this.draw();
  },
  // everything that depends on the canvas size: the refraction and parallax amounts are in canvas pixels
  applySize(){
    let gl=this.gl,o=this.options;
    gl.createUniform("2f","resolution",this.width,this.height);
    gl.createUniform("1f","minRefraction",o.minRefraction);
    gl.createUniform("1f","refractionDelta",o.maxRefraction-o.minRefraction);
    gl.createUniform("1f","parallaxBg",o.parallaxBg);
    gl.createUniform("1f","parallaxFg",o.parallaxFg);
    gl.gl.viewport(0,0,this.width,this.height);
  },
  draw(){
    this.gl.gl.uniform2f(this.parallaxLoc,this.parallaxX,this.parallaxY);
    this.updateTexture();
    this.gl.draw();
  },
  setImages(fg,bg){
    this.imageFg=fg;this.imageBg=bg;this.textures[1].img=fg;this.textures[2].img=bg;
    this.gl.createUniform("1f","textureRatio",bg.width/bg.height);
    this.updateTextures();
  },
  updateTextures(){
    this.textures.forEach((texture,i)=>{
      this.gl.activeTexture(i+1);
      this.gl.updateTexture(texture.img);
    })
  },
  // the water map is re-uploaded every frame: overwrite the existing texture when its size is unchanged
  updateTexture(){
    let c=this.canvasLiquid;
    this.gl.activeTexture(0);
    if(c.width===this.liquidW&&c.height===this.liquidH){
      this.gl.updateSubTexture(c);
    }else{
      this.gl.updateTexture(c);
      this.liquidW=c.width;
      this.liquidH=c.height;
    }
  },
  // new canvas size and water map (and the pixel-based amounts that go with them); keeps the GL context and textures
  resize(width,height,canvasLiquid,options){
    this.canvas.width=width;
    this.canvas.height=height;
    this.width=width;
    this.height=height;
    this.canvasLiquid=canvasLiquid;
    Object.assign(this.options,options);
    this.applySize();
  }
}

export default RainRenderer;
