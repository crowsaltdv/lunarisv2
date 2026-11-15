import * as WebGL from "./webgl.js?v=3";

function GL(canvas,options,vert,frag){
  this.init(canvas,options,vert,frag);
}
GL.prototype={
  canvas:null,
  gl:null,
  program:null,
  width:0,
  height:0,
  rectUploaded:false,
  init(canvas,options,vert,frag){
    this.canvas=canvas;
    this.width=canvas.width;
    this.height=canvas.height;
    this.gl=WebGL.getContext(canvas,options);
    this.locations={};
    this.program=this.createProgram(vert,frag);
    this.useProgram(this.program);
  },
  createProgram(vert,frag){
    let program=WebGL.createProgram(this.gl,vert,frag);
    return program;
  },
  useProgram(program){
    this.program=program;
    this.gl.useProgram(program);
  },
  createTexture(source,i){
    return WebGL.createTexture(this.gl,source,i);
  },
  createUniform(type,name,...v){
    WebGL.createUniform(this.gl,this.program,type,name,...v);
  },
  // looked up once, for uniforms that change every frame
  uniformLocation(name){
    return this.locations[name]||(this.locations[name]=this.gl.getUniformLocation(this.program,"u_"+name));
  },
  activeTexture(i){
    WebGL.activeTexture(this.gl,i);
  },
  updateTexture(source){
    WebGL.updateTexture(this.gl,source);
  },
  updateSubTexture(source){
    WebGL.updateSubTexture(this.gl,source);
  },
  draw(){
    // the full-screen quad never changes: upload it once, not every frame
    if(!this.rectUploaded){
      WebGL.setRectangle(this.gl, -1, -1, 2, 2);
      this.rectUploaded=true;
    }
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }
}

export default GL;
