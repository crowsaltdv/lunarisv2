const linear=(n)=>n;

export function random(from=null,to=null,interpolation=linear){
  if(from==null){
    from=0;
    to=1;
  }else if(to==null){
    to=from;
    from=0;
  }
  return from+(interpolation(Math.random())*(to-from));
}
// called thousands of times a frame, so it must not allocate
export function chance(c){
  return Math.random()<=c;
}
