import clipping from 'polygon-clipping';
import {simplePolygon,type Shape} from './plan-geometry';
type P=[number,number];
export function polygonArea(points:P[]){return Math.abs(points.reduce((s,p,i)=>s+p[0]*points[(i+1)%points.length][1]-points[(i+1)%points.length][0]*p[1],0))/2;}
function one(result:clipping.MultiPolygon){if(result.length!==1||result[0].length!==1)throw Error('DISCONNECTED_BOUNDARY');const points=result[0][0].slice(0,-1) as P[];if(points.length>64||!simplePolygon(points))throw Error('INVALID_BOUNDARY');return points;}
export function mergeBoundaries(shapes:Shape[]){if(shapes.length<2||new Set(shapes.map(s=>s.page)).size!==1)throw Error('SAME_PAGE_REQUIRED');return one(clipping.union([shapes[0].points],...shapes.slice(1).map(s=>[s.points])));}
export function splitBoundary(shape:Shape,axis:'x'|'y',ratio:number){if(ratio<=0||ratio>=1)throw Error('INVALID_SPLIT');const i=axis==='x'?0:1,values=shape.points.map(p=>p[i]),cut=Math.min(...values)+(Math.max(...values)-Math.min(...values))*ratio;
 const boxes:P[][]=axis==='x'?[[[0,0],[cut,0],[cut,1],[0,1]],[[cut,0],[1,0],[1,1],[cut,1]]]:[[[0,0],[1,0],[1,cut],[0,cut]],[[0,cut],[1,cut],[1,1],[0,1]]];return boxes.map(b=>one(clipping.intersection([shape.points],[b])));}
export function sameCoverage(before:Shape[],after:Shape[]){if(new Set([...before,...after].map(s=>s.page)).size!==1)return false;const a=clipping.union([before[0].points],...before.slice(1).map(s=>[s.points])),b=clipping.union([after[0].points],...after.slice(1).map(s=>[s.points]));const delta=clipping.xor(a,b);return delta.reduce((sum,p)=>sum+polygonArea(p[0] as P[]),0)<1e-9;}
