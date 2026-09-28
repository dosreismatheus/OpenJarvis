import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei';
import { DataTexture, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three';
import type { SquadAgent, SquadConnection } from '../lib/squads';

export type CampusArea = { id: string; name: string; floor: number; description: string; people: string; status: string; color: string };
export type CampusHover = { title: string; detail: string; color: string } | null;
type Vec3 = [number, number, number];

export const AGENT_STATUS = { idle: 'Disponível', working: 'Trabalhando', blocked: 'Bloqueado', review: 'Em revisão' };
export function agentColor(status: SquadAgent['status']) {
  return { idle: '#91a0aa', working: '#73cbaa', blocked: '#eab77e', review: '#a4ace0' }[status];
}

// Small, repeatable material maps keep the maquette tactile without external assets.
function surfaceTexture(kind: 'stone' | 'grass' | 'wood') {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
    const noise = ((hash ^ (hash >>> 13)) >>> 0) % 100 / 100;
    const grain = kind === 'wood' ? Math.sin(x * .35 + Math.sin(y * .07) * 1.4) * 10 : kind === 'grass' ? Math.sin(x * .09) * Math.cos(y * .11) * 13 : 0;
    const value = (kind === 'grass' ? 210 : 238) + (noise - .5) * (kind === 'grass' ? 38 : 19) + grain;
    const i = (y * size + x) * 4;
    pixels[i] = value; pixels[i + 1] = value; pixels[i + 2] = value; pixels[i + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(kind === 'wood' ? 4 : 6, kind === 'wood' ? 1 : 6);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const Materials = createContext<ReturnType<typeof makeTextures> | null>(null);
function makeTextures() { return { stone: surfaceTexture('stone'), grass: surfaceTexture('grass'), wood: surfaceTexture('wood') }; }
function Surface({ color, kind = 'stone', roughness = .8 }: { color: string; kind?: 'stone' | 'grass' | 'wood'; roughness?: number }) {
  const maps = useContext(Materials);
  return <meshStandardMaterial color={color} map={maps?.[kind]} bumpMap={maps?.[kind]} bumpScale={kind === 'grass' ? .005 : kind === 'wood' ? .0015 : .003} roughness={roughness} metalness={.02} />;
}
function Block({ at, size, color, kind, round = 0 }: { at: Vec3; size: Vec3; color: string; kind?: 'stone' | 'grass' | 'wood'; round?: number }) {
  return round ? <RoundedBox position={at} args={size} radius={Math.min(round, ...size.map(value => value * .48))} smoothness={2} castShadow receiveShadow><Surface color={color} kind={kind} /></RoundedBox> :
    <mesh position={at} castShadow receiveShadow><boxGeometry args={size} /><Surface color={color} kind={kind} /></mesh>;
}
function Glass() {
  return <meshPhysicalMaterial color="#343741" roughness={.18} metalness={.32} clearcoat={1} clearcoatRoughness={.14} envMapIntensity={.9} emissive="#252630" emissiveIntensity={.13} />;
}
function LightStrip({ at, size, color = '#ffe2b0' }: { at: Vec3; size: Vec3; color?: string }) {
  return <mesh position={at}><boxGeometry args={size} /><meshBasicMaterial color={color} /></mesh>;
}
function Tree({ at, scale = 1, planter = false }: { at: Vec3; scale?: number; planter?: boolean }) {
  return <group position={at} scale={scale}>
    {planter && <Block at={[0, .13, 0]} size={[.83, .26, .83]} color="#cec9b8" round={.08} />}
    <mesh position={[0, .62, 0]} castShadow><cylinderGeometry args={[.075, .13, 1.24, 8]} /><Surface color="#86725a" kind="wood" /></mesh>
    <mesh position={[0, 1.55, 0]} castShadow><icosahedronGeometry args={[.72, 2]} /><Surface color="#668569" kind="grass" /></mesh>
    <mesh position={[-.27, 1.88, .03]} castShadow><icosahedronGeometry args={[.49, 2]} /><Surface color="#7c9774" kind="grass" /></mesh>
    <mesh position={[.32, 1.46, .21]} castShadow><icosahedronGeometry args={[.47, 2]} /><Surface color="#526f56" kind="grass" /></mesh>
  </group>;
}
function Bench({ at, rotation = 0 }: { at: Vec3; rotation?: number }) {
  return <group position={at} rotation={[0, rotation, 0]}>
    <Block at={[0, .42, 0]} size={[1.6, .1, .49]} color="#b8946b" kind="wood" round={.025} />
    {[-.61, .61].map(x => <Block key={x} at={[x, .21, 0]} size={[.09, .4, .37]} color="#535c5b" />)}
    <Block at={[0, .7, -.21]} size={[1.6, .3, .065]} color="#b8946b" kind="wood" />
  </group>;
}
function Bollard({ x, z }: { x: number; z: number }) {
  return <group position={[x, .06, z]}>
    <Block at={[0, .26, 0]} size={[.11, .52, .11]} color="#4e5b58" />
    <LightStrip at={[0, .49, 0]} size={[.125, .065, .125]} />
  </group>;
}
function Walkway({ x, z }: { x: number; z: number }) {
  const distance = Math.hypot(x, z);
  return <group position={[x / 2, .072, z / 2]} rotation={[0, Math.atan2(x, z), 0]}>
    <Block at={[0, 0, 0]} size={[.9, .075, distance]} color="#d0cebf" />
    {Array.from({ length: Math.floor(distance / .7) }, (_, i) => <Block key={i} at={[0, .041, i * .7 - distance / 2 + .3]} size={[.9, .006, .014]} color="#9da497" />)}
  </group>;
}

const SITES: [number, number][] = [[6.4, 4], [-6.4, 3.8], [6.8, -3.4], [-6.8, -3.4], [0, 6.5], [0, -6.6], [9, .3], [-9, .3]];
function sitePosition(index: number, count: number): [number, number] {
  if (count <= SITES.length) return SITES[index];
  const angle = index / count * Math.PI * 2;
  const radius = Math.max(8, count * .66);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

function Headquarters({ areas, onEnter, onHover }: { areas: CampusArea[]; onEnter: (id: string) => void; onHover: (value: CampusHover) => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return <group position={[0, .12, -.7]}
    onClick={e => { e.stopPropagation(); onEnter('diretoria'); }}
    onPointerOver={e => { e.stopPropagation(); onHover({ title: 'Prédio central', detail: '6 andares · Clique para entrar', color: '#ef7377' }); }}
    onPointerOut={() => onHover(null)}>
    <Block at={[0, .1, 0]} size={[5.7, .2, 4.7]} color="#39393f" round={.08} />
    <Block at={[0, .04, 2.8]} size={[2.8, .08, 1.2]} color="#515055" round={.035} />
    {areas.map((area, index) => {
      const y = .65 + index * .83;
      const active = hovered === area.id;
      const setback = area.id === 'diretoria' ? .88 : area.id === 'produto' ? .95 : 1;
      return <group key={area.id} scale={[setback, 1, setback]}
        onClick={e => { e.stopPropagation(); onEnter(area.id); }}
        onPointerOver={e => { e.stopPropagation(); setHovered(area.id); onHover({ title: area.name, detail: String(area.floor).padStart(2, '0') + 'º andar · Clique para entrar', color: area.color }); }}
        onPointerOut={() => { setHovered(null); onHover(null); }}>
        <Block at={[0, y, 0]} size={[4.64, .76, 3.6]} color="#292a30" />
        {[-1, 1].map(side => <group key={side}>
          <mesh position={[0, y, side * 1.807]}><boxGeometry args={[4.37, .64, .04]} /><Glass /></mesh>
          <mesh position={[side * 2.335, y, 0]}><boxGeometry args={[.04, .64, 3.3]} /><Glass /></mesh>
          {[-1.58, -.53, .53, 1.58].map(x => <Block key={x} at={[x, y, side * 1.84]} size={[.035, .69, .047]} color="#535159" />)}
          {[-1.16, 0, 1.16].map(z => <Block key={z} at={[side * 2.365, y, z]} size={[.04, .69, .038]} color="#535159" />)}
        </group>)}
        <Block at={[0, y + .4, 0]} size={[4.92, .14, 3.9]} color={active ? '#cb2835' : area.id === 'marketing' || area.id === 'diretoria' ? '#ad111e' : '#25262c'} round={.035} />
        <LightStrip at={[0, y + .305, 1.839]} size={[4.35, .018, .019]} color={active ? area.color : '#b74249'} />
        <LightStrip at={[2.364, y + .305, 0]} size={[.019, .018, 3.28]} color={active ? area.color : '#b74249'} />
        {area.id === 'gestores' && <Block at={[-1.63,y,1.865]} size={[1.08,.67,.1]} color="#a91220" />}
        {area.id === 'vendas' && [-1.64,1.64].map(x => <Block key={x} at={[x,y,1.88]} size={[.17,.68,.11]} color="#a91220" />)}
        {area.id === 'marketing' && [-1.28,-.9,-.52,-.14].map(z => <Block key={z} at={[2.42,y,z]} size={[.19,.69,.12]} color="#bf1725" />)}
        {area.id === 'produto' && <><Block at={[0,y-.32,2.01]} size={[4.75,.1,.58]} color="#3a393e" /><Block at={[-1.2,y-.16,2.1]} size={[1.5,.23,.32]} color="#576649" kind="grass" round={.07} /></>}
        {area.id === 'administrativo' && [-.17,0,.17].map(offset => <Block key={offset} at={[2.4,y+offset,0]} size={[.16,.1,3.35]} color="#24252b" />)}
        {active && <mesh position={[0, y, 0]}><boxGeometry args={[4.8, .79, 3.78]} /><meshBasicMaterial color={area.color} transparent opacity={.1} depthWrite={false} /></mesh>}
      </group>;
    })}
    <Block at={[0, 5.45, 0]} size={[5.04, .2, 4.05]} color="#bb171d" round={.055} />
    <Block at={[0, 5.58, 0]} size={[4.55, .08, 3.55]} color="#80916c" kind="grass" />
    <Block at={[-.48, 5.76, -.2]} size={[2.6, .35, 2.05]} color="#28292f" round={.055} />
    <Block at={[-.48, 5.96, -.2]} size={[2.74, .08, 2.18]} color="#34343a" />
    {[-1, 0, 1].map(i => <Block key={i} at={[i * 1.08, 5.83, 1.38]} size={[.76, .43, .3]} color="#597557" kind="grass" round={.1} />)}
    <Tree at={[1.62, 5.62, -.9]} scale={.49} planter />
    <Block at={[0, .64, 1.96]} size={[1.27, .94, .13]} color="#292b32" />
    <Block at={[0, 1.15, 2.21]} size={[1.9, .12, .85]} color="#a91220" round={.025} />
    <LightStrip at={[0, 1.073, 2.53]} size={[1.55, .023, .022]} />
    {[-.82, .82].map(x => <Block key={x} at={[x, .65, 2.52]} size={[.065, .97, .065]} color="#39383f" />)}
  </group>;
}

function Pavilion({ squad, at, onEnter, onHover }: { squad: SquadConnection; at: [number, number]; onEnter: () => void; onHover: (value: CampusHover) => void }) {
  const [hovered, setHovered] = useState(false);
  const statusColor = squad.online ? '#84d4b3' : '#d69587';
  return <group position={[at[0], .13, at[1]]}
    onClick={e => { e.stopPropagation(); onEnter(); }}
    onPointerOver={e => { e.stopPropagation(); setHovered(true); onHover({ title: squad.data?.name || squad.name, detail: (squad.online ? 'Squad conectada' : 'Squad indisponível') + ' · Clique para entrar', color: statusColor }); }}
    onPointerOut={() => { setHovered(false); onHover(null); }}>
    <Block at={[0, .08, .17]} size={[3.5, .16, 3.5]} color="#45454b" round={.065} />
    <Block at={[0, .25, 1.35]} size={[3.15, .18, .95]} color="#bfa885" kind="wood" />
    <Block at={[0, 1.05, 0]} size={[2.8, 1.62, 2.45]} color="#292a30" round={.035} />
    <mesh position={[0, 1.05, 1.24]}><boxGeometry args={[2.52, 1.29, .05]} /><Glass /></mesh>
    <mesh position={[1.419, 1.05, 0]}><boxGeometry args={[.04, 1.29, 2.11]} /><Glass /></mesh>
    {[-.88, 0, .88].map(x => <Block key={x} at={[x, 1.05, 1.28]} size={[.055, 1.38, .05]} color="#565159" />)}
    {[-.86, -.58, -.3].map(z => <Block key={z} at={[1.47, 1.04, z]} size={[.1, 1.56, .09]} color="#b79c77" kind="wood" />)}
    <Block at={[0, 1.94, 0]} size={[3.2, .19, 2.82]} color={hovered ? '#e15d64' : '#b91a21'} round={.055} />
    <Block at={[0, 2.08, -.25]} size={[2.62, .12, 1.72]} color="#799367" kind="grass" round={.075} />
    <Block at={[-.7, 2.21, -.78]} size={[.72, .2, .4]} color="#aeb4a1" />
    <LightStrip at={[0, 1.82, 1.29]} size={[2.53, .035, .025]} color={hovered ? '#ef7377' : statusColor} />
    <Tree at={[-1.37, .17, 1.37]} scale={.32} planter />
    {hovered && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .18, .14]}><ringGeometry args={[2.13, 2.16, 64]} /><meshBasicMaterial color={statusColor} transparent opacity={.7} /></mesh>}
  </group>;
}

function Landscaping({ squadCount }: { squadCount: number }) {
  const trees: [number, number, number][] = [[-9,-6.7,.94],[-9.1,-4.9,.64],[-9,6.5,.92],[-7,6.9,.71],[-4.1,7.2,.65],[9,6.5,.82],[9.6,4.8,.68],[8.8,-6.6,.85],[6.8,-7.1,.66],[-3.3,-6.8,.64],[3.4,-6.8,.66],[3.3,7.2,.63]];
  return <>
    {trees.map(([x,z,scale], i) => <Tree key={i} at={[x,.05,z]} scale={scale} />)}
    <Block at={[0, .07, 2.65]} size={[5.7, .12, 1.65]} color="#d4d0bf" round={.08} />
    {[-3.1, 3.1].map(x => <group key={x}>
      <Block at={[x, .24, 1.05]} size={[.59, .4, 3.9]} color="#bac0ac" round={.055} />
      <Block at={[x, .53, 1.05]} size={[.43, .36, 3.64]} color="#68835d" kind="grass" round={.12} />
    </group>)}
    <Walkway x={0} z={8.9} />
    {[-1.05,1.05].map(x => [3.55,5.05,7.85].map(z => <Bollard key={x + ':' + z} x={x} z={z} />))}
    <Bench at={[-2.1,.13,3]} />
    <Bench at={[2.1,.13,3]} />
    {squadCount < 2 && <group position={[-6.2,.12,3.7]}>
      <Block at={[0,.03,0]} size={[3.8,.1,3.6]} color="#c8c8b5" round={.16} />
      <mesh position={[0,.15,0]} receiveShadow><cylinderGeometry args={[1.08,1.18,.25,48]} /><Surface color="#b4c0b4" /></mesh>
      <mesh position={[0,.3,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.94,48]} /><meshPhysicalMaterial color="#558b91" metalness={.35} roughness={.18} clearcoat={1} /></mesh>
      <mesh position={[0,.57,0]} castShadow><sphereGeometry args={[.31,24,24]} /><meshStandardMaterial color="#b7bdaa" metalness={.52} roughness={.22} /></mesh>
      <Bench at={[-1.58,.06,0]} rotation={Math.PI/2} />
      <Tree at={[1.36,.06,-1.25]} scale={.6} planter />
    </group>}
  </>;
}

function OfficeChair({ at, rotation = 0 }: { at: Vec3; rotation?: number }) {
  return <group position={at} rotation={[0,rotation,0]}>
    <Block at={[0,.49,0]} size={[.58,.13,.55]} color="#48484e" round={.09} />
    <Block at={[0,.89,.22]} size={[.58,.64,.11]} color="#48484e" round={.045} />
    <mesh position={[0,.24,0]}><cylinderGeometry args={[.055,.055,.42,10]} /><meshStandardMaterial color="#9a9e99" metalness={.6} roughness={.25} /></mesh>
    <Block at={[0,.065,0]} size={[.58,.07,.08]} color="#707976" />
    <Block at={[0,.065,0]} size={[.08,.07,.58]} color="#707976" />
  </group>;
}
function AgentDesk({ agent, index, rows, selected, onChoose, onHover }: { agent: SquadAgent; index: number; rows: number; selected: boolean; onChoose: () => void; onHover: (value: CampusHover) => void }) {
  const [hovered, setHovered] = useState(false);
  const x = (index % 3 - 1) * 2.85;
  const z = (Math.floor(index / 3) - (rows - 1) / 2) * 2.65;
  const color = agentColor(agent.status);
  const shirt = ['#943d44','#66656e','#a89c98','#7d353f','#727075','#53535c'][index % 6];
  return <group position={[x,.19,z]} onClick={e => { e.stopPropagation(); onChoose(); }}
    onPointerOver={e => { e.stopPropagation(); setHovered(true); onHover({ title: agent.name, detail: AGENT_STATUS[agent.status] + ' · Clique para acompanhar', color }); }}
    onPointerOut={() => { setHovered(false); onHover(null); }}>
    <Block at={[0,.8,0]} size={[2.22,.12,1.12]} color={selected || hovered ? '#ddc39b' : '#c4ad87'} kind="wood" round={.04} />
    {[-.94,.94].map(leg => <Block key={leg} at={[leg,.41,0]} size={[.07,.75,.75]} color="#ccd0c5" />)}
    <Block at={[0,1.23,-.28]} size={[.95,.59,.075]} color="#414d51" round={.025} />
    <mesh position={[0,1.24,-.235]}><planeGeometry args={[.85,.48]} /><meshStandardMaterial color="#2c2c34" emissive="#705258" emissiveIntensity={.35} /></mesh>
    {[0,1,2].map(i => <LightStrip key={i} at={[-.08,1.37-i*.11,-.232]} size={[.44-i*.08,.024,.007]} color={i ? '#aaa0a3' : color} />)}
    <Block at={[0,.96,-.29]} size={[.065,.16,.065]} color="#6e7d7f" />
    <Block at={[0,.88,.17]} size={[.6,.035,.23]} color="#9ca8a7" round={.012} />
    <mesh position={[.83,.94,.06]}><cylinderGeometry args={[.065,.06,.17,12]} /><meshStandardMaterial color="#f1e9d6" roughness={.45} /></mesh>
    <LightStrip at={[.94,.87,-.43]} size={[.1,.026,.1]} color={color} />
    <OfficeChair at={[0,0,.81]} />
    <mesh position={[0,.94,.71]} castShadow><capsuleGeometry args={[.18,.28,4,12]} /><Surface color={shirt} /></mesh>
    <mesh position={[0,1.43,.7]} castShadow><sphereGeometry args={[.19,16,16]} /><meshStandardMaterial color={['#d6b698','#b88f70','#dfc9ab'][index%3]} roughness={.8} /></mesh>
    <mesh position={[0,1.53,.72]} castShadow><sphereGeometry args={[.184,16,12,0,Math.PI*2,0,Math.PI/2]} /><Surface color="#504c44" /></mesh>
    {[-1,1].map(side => <group key={side}>
      <mesh position={[side*.22,.95,.47]} rotation={[.7,0,side*.13]} castShadow><capsuleGeometry args={[.066,.27,4,8]} /><Surface color={shirt} /></mesh>
      <Block at={[side*.12,.54,.51]} size={[.14,.13,.49]} color="#414148" round={.04} />
    </group>)}
    {(selected || hovered) && <mesh position={[0,.027,.2]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[1.09,1.12,48]} /><meshBasicMaterial color={color} transparent opacity={.85} /></mesh>}
  </group>;
}

function MeetingRoom({ accent }: { accent: string }) {
  return <>
    <Block at={[0,.22,0]} size={[6,.03,4]} color="#a6878a" round={.07} />
    <Block at={[0,1,0]} size={[4.5,.16,1.9]} color="#c1a47e" kind="wood" round={.14} />
    {[-1.5,1.5].map(x => <Block key={x} at={[x,.6,0]} size={[.2,.78,1.22]} color="#bcc0b5" />)}
    {[-1.4,0,1.4].map(x => [-1,1].map(side => <OfficeChair key={x + ':' + side} at={[x,.19,side*1.37]} rotation={side===-1 ? Math.PI : 0} />))}
    <Block at={[0,1.12,0]} size={[.68,.04,.5]} color="#485d63" round={.02} />
    <mesh position={[-1.23,1.18,.12]}><cylinderGeometry args={[.08,.08,.19,12]} /><meshStandardMaterial color="#eee7d8" /></mesh>
    <Block at={[-5.48,1.94,-.55]} size={[.06,1.5,2.8]} color="#39383f" round={.02} />
    {[0,1,2,3].map(i => <LightStrip key={i} at={[-5.441,2.38-i*.27,-.5]} size={[.009,.06,1.4-i*.18]} color={i===0 ? accent : '#b6adb0'} />)}
  </>;
}

function Workstation({ at, rotation = 0 }: { at: Vec3; rotation?: number }) {
  return <group position={at} rotation={[0,rotation,0]}>
    <Block at={[0,.81,0]} size={[2.25,.13,1.12]} color="#59433c" kind="wood" round={.04} />
    {[-.94,.94].map(x => <Block key={x} at={[x,.4,0]} size={[.09,.8,.9]} color="#28292f" />)}
    <Block at={[0,1.24,-.27]} size={[1.05,.65,.08]} color="#17191f" round={.025} />
    <Block at={[0,1.25,-.22]} size={[.93,.52,.02]} color="#4a424c" />
    <LightStrip at={[0,1.42,-.2]} size={[.72,.025,.012]} color="#e10606" />
    <Block at={[0,.98,-.27]} size={[.08,.2,.08]} color="#28292f" />
    <Block at={[0,.91,.2]} size={[.65,.035,.24]} color="#313239" round={.01} />
    <OfficeChair at={[0,0,.95]} />
  </group>;
}

function RoundTable({ at, radius = .85 }: { at: Vec3; radius?: number }) {
  return <group position={at}>
    <mesh position={[0,.77,0]} castShadow receiveShadow><cylinderGeometry args={[radius,radius,.13,40]} /><Surface color="#795a4c" kind="wood" /></mesh>
    <mesh position={[0,.39,0]} castShadow><cylinderGeometry args={[.12,.27,.72,16]} /><Surface color="#26272d" /></mesh>
  </group>;
}

// Corporate floors are architectural spaces, not simulated agents or live metrics.
function CorporateRoom({ areaId }: { areaId: string }) {
  if (areaId === 'diretoria') return <>
    <Block at={[.7,.22,-.6]} size={[7.2,.035,5.5]} color="#3b3037" round={.12} />
    <group position={[1.4,.2,-1.6]} rotation={[0,Math.PI,0]}><Workstation at={[0,0,0]} /><Block at={[0,.55,-.4]} size={[2.5,1,.17]} color="#921420" /></group>
    <OfficeChair at={[.6,.2,.05]} /><OfficeChair at={[2.2,.2,.05]} />
    <group position={[-3,.2,.6]}>
      <Block at={[0,.35,0]} size={[1.15,.5,2.9]} color="#25262c" round={.15} />
      <Block at={[-.48,.72,0]} size={[.23,.78,2.9]} color="#941522" round={.1} />
      {[-1.36,1.36].map(z => <Block key={z} at={[0,.64,z]} size={[1.15,.47,.19]} color="#941522" round={.06} />)}
    </group>
    <RoundTable at={[-1.35,.2,1]} radius={.62} />
    <Block at={[1.3,.66,-3.65]} size={[4,.9,.6]} color="#24252b" round={.05} />
    <LightStrip at={[1.3,1.13,-3.65]} size={[3.8,.035,.55]} color="#aa1623" />
  </>;
  if (areaId === 'administrativo') return <>
    {[-2.4,1].map(x => <Workstation key={x} at={[x,.2,.5]} />)}
    {[-3.9,-2.4,-.9].map(x => <group key={x} position={[x,.2,-3.6]}>
      <Block at={[0,1.03,0]} size={[1.35,2.05,.72]} color="#34353c" round={.04} />
      {[.35,1,1.65].map(y => <group key={y}><Block at={[0,y,.375]} size={[1.2,.55,.035]} color="#515159" /><Block at={[0,y+.1,.41]} size={[.32,.045,.05]} color="#a62630" /></group>)}
    </group>)}
    <Block at={[3.5,.66,-1.9]} size={[1.4,.9,1]} color="#991925" />
    <Block at={[3.5,1.33,-1.9]} size={[1.1,.42,.76]} color="#41424a" round={.04} />
    <Block at={[3.5,1.57,-1.83]} size={[.62,.04,.43]} color="#bfbab7" />
    {[-2.9,-2.8,-2.7].map((x,i) => <Block key={x} at={[x,1.11+i*.055,.7]} size={[.55,.045,.42]} color={i===1 ? '#9a1724' : '#c1b9b5'} />)}
  </>;
  if (areaId === 'marketing') return <>
    <Block at={[2,.23,-1.6]} size={[4.3,.06,3.8]} color="#971321" round={.1} />
    <Block at={[2,1.63,-3.4]} size={[4.3,2.8,.16]} color="#ad1220" round={.1} />
    <RoundTable at={[2,.2,-1.9]} radius={.58} />
    <Workstation at={[-3,.2,.1]} />
    {[-2.7,-1.8,-.9,0,.9].map(z => <Block key={z} at={[-5.48,1.85,z]} size={[.15,1.7,.6]} color="#24252c" round={.04} />)}
    {[[-.05,-1.4],[4,-1.4],[2,1.55]].map(([x,z],i) => <group key={i} position={[x,.2,z]}>
      <Block at={[0,.83,0]} size={[.055,1.6,.055]} color="#36373f" />
      {[0,1,2].map(leg => <group key={leg} rotation={[0,leg*Math.PI*2/3,0]}><Block at={[0,.08,.22]} size={[.045,.06,.57]} color="#303138" /></group>)}
      {i===2 ? <><Block at={[0,1.66,0]} size={[.44,.33,.33]} color="#22232b" round={.035} /><mesh position={[0,1.66,-.23]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.13,.13,.2,16]} /><Glass /></mesh></> : <group rotation={[0,i===0 ? -.55 : .55,0]}><Block at={[0,1.95,0]} size={[.9,1.15,.2]} color="#292a30" round={.07} /><LightStrip at={[0,1.95,.11]} size={[.76,1.01,.025]} color="#eadbd0" /></group>}
    </group>)}
  </>;
  if (areaId === 'produto') return <>
    <Block at={[.6,.22,.15]} size={[6.8,.035,5.3]} color="#791c29" round={.09} />
    <Block at={[.5,1.23,0]} size={[4.6,.16,2.1]} color="#a47c61" kind="wood" round={.07} />
    {[-1.3,2.3].map(x => <Block key={x} at={[x,.72,0]} size={[.16,1,1.6]} color="#292a30" />)}
    {[-.9,.5,1.9].map(x => [-1.6,1.6].map(z => <group key={x+':'+z} position={[x,.2,z]}><Block at={[0,.65,0]} size={[.53,.12,.53]} color="#37373f" round={.05} /><Block at={[0,.3,0]} size={[.11,.65,.11]} color="#292a30" /></group>))}
    <Block at={[.3,1.33,0]} size={[1.8,.035,1.15]} color="#67616d" />
    {[-.3,.2,.7].map((x,i) => <Block key={x} at={[x,1.46+i*.06,-.1]} size={[.3,.22+i*.12,.4]} color={i===1 ? '#a71624' : '#96919b'} round={.02} />)}
    <Block at={[-5.48,1.95,-.6]} size={[.12,1.9,4.4]} color="#55515a" round={.04} />
    {[-2,-.7,.6].map(z => [1.5,2.1,2.6].map(y => <Block key={z+':'+y} at={[-5.4,y,z]} size={[.025,.28,.48]} color={y===2.6 ? '#b22130' : '#b4aaa4'} />))}
  </>;
  if (areaId === 'vendas') return <>
    {[-3.1,-.25].map(x => [-1.9,1.1].map(z => <group key={x+':'+z}><Workstation at={[x,.2,z]} /><Block at={[x,1.35,z-.58]} size={[2.25,.7,.08]} color="#961623" round={.03} /></group>))}
    <RoundTable at={[3.35,.2,.1]} radius={1} />
    <OfficeChair at={[3.35,.2,1.45]} /><OfficeChair at={[3.35,.2,-1.25]} rotation={Math.PI} />
    <Block at={[3.4,.65,-3.7]} size={[1.5,.9,.55]} color="#92202a" round={.05} />
  </>;
  return <>
    <Block at={[0,.22,.15]} size={[8,.03,5.5]} color="#292b33" round={.1} />
    {[-3.1,0,3.1].map(x => <group key={x}>
      <Block at={[x,1.93,-4.45]} size={[2.7,1.52,.13]} color="#15171e" round={.05} />
      <Block at={[x,1.93,-4.37]} size={[2.5,1.32,.025]} color="#3a3641" />
      <LightStrip at={[x,2.48,-4.35]} size={[2.2,.035,.015]} color="#d52231" />
      <Workstation at={[x,.2,-1.8]} />
    </group>)}
    <group position={[-3.3,0,1.6]} rotation={[0,-Math.PI/2,0]}><Workstation at={[0,.2,0]} /></group>
    <group position={[3.3,0,1.6]} rotation={[0,Math.PI/2,0]}><Workstation at={[0,.2,0]} /></group>
  </>;
}

function Interior({ squad, areaId, selectedAgent, onAgent, onHover, accent }: { squad?: SquadConnection; areaId?: string; selectedAgent: string | null; onAgent: (id: string) => void; onHover: (value: CampusHover) => void; accent: string }) {
  const agents = squad?.data?.agents.slice(0,9) || [];
  const woodFloor = !areaId || areaId === 'diretoria' || areaId === 'produto';
  return <>
    <Block at={[0,0,0]} size={[11.7,.34,9.6]} color="#26272e" round={.11} />
    <Block at={[0,.18,0]} size={[11.3,.035,9.2]} color={woodFloor ? '#796052' : areaId === 'administrativo' ? '#65616a' : '#36363f'} kind={woodFloor ? 'wood' : 'stone'} />
    {Array.from({length:16},(_,i) => <Block key={i} at={[-5.25+i*.7,.2,0]} size={[.012,.006,9.16]} color={woodFloor ? '#59473e' : '#303139'} />)}
    <Block at={[0,1.62,-4.65]} size={[11.5,2.95,.16]} color="#303038" />
    <Block at={[-5.65,1.62,0]} size={[.16,2.95,9.2]} color={areaId === 'marketing' ? '#303038' : '#851320'} />
    {areaId !== 'gestores' && <><mesh position={[.15,1.87,-4.546]}><boxGeometry args={[8.7,1.78,.04]} /><Glass /></mesh>
    {[-3,-1,1,3].map(x => <Block key={x} at={[x,1.87,-4.5]} size={[.045,1.84,.055]} color="#53515a" />)}</>}
    <Block at={[0,3.12,-4.58]} size={[11.7,.13,.28]} color="#ad1421" />
    <Block at={[-5.62,3.12,0]} size={[.28,.13,9.4]} color="#ad1421" />
    <LightStrip at={[0,2.89,-4.53]} size={[10.8,.025,.04]} color="#d46c65" />
    <Tree at={[-4.65,.2,-3.65]} scale={.83} planter />
    <Tree at={[4.65,.2,-3.65]} scale={.83} planter />
    <Block at={[4.65,.67,2.97]} size={[1.25,.95,.73]} color="#34353c" round={.04} />
    <Block at={[4.65,1.17,2.97]} size={[1.32,.06,.78]} color="#d3ba93" kind="wood" />
    {[0,1,2,3].map(i => <Block key={i} at={[4.29+i*.15,1.4,2.96]} size={[.11,.4-(i%2)*.08,.29]} color={['#a42c38','#c9b59b','#60616a','#8a4149'][i]} />)}
    {areaId ? <CorporateRoom areaId={areaId} /> : agents.length ? agents.map((agent,i) => <AgentDesk key={agent.id} agent={agent} index={i} rows={Math.ceil(agents.length/3)} selected={agent.id===selectedAgent} onChoose={() => onAgent(agent.id)} onHover={onHover} />) : <MeetingRoom accent={accent} />}
  </>;
}

function CameraFit({ interior, zoomCommand }: { interior: boolean; zoomCommand: { step: number; revision: number } }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    camera.zoom = Math.max(interior ? 11 : 16, Math.min(size.width/(interior ? 17 : 31), size.height/(interior ? 12 : 21)));
    camera.updateProjectionMatrix(); invalidate();
  }, [camera,size.width,size.height,interior,invalidate]);
  useEffect(() => {
    if (!zoomCommand.revision) return;
    camera.zoom = Math.max(10,Math.min(90,camera.zoom*(zoomCommand.step>0 ? 1.22 : 1/1.22)));
    camera.updateProjectionMatrix(); invalidate();
  }, [camera,zoomCommand,invalidate]);
  return null;
}

export function SevenCampusScene({ squads, areas, squad, areaId, interior, selectedAgent, accent, onArea, onSquad, onAgent, onHover, zoomCommand }: {
  squads: SquadConnection[]; areas: CampusArea[]; squad?: SquadConnection; areaId?: string; interior: boolean; selectedAgent: string | null; accent: string;
  onArea: (id: string) => void; onSquad: (id: string) => void; onAgent: (id: string) => void; onHover: (value: CampusHover) => void;
  zoomCommand: { step: number; revision: number };
}) {
  const textures = useMemo(makeTextures,[]);
  useEffect(() => () => Object.values(textures).forEach(texture => texture.dispose()),[textures]);
  const radius = squads.length > 8 ? Math.max(8,squads.length*.66) : 9;
  return <Materials.Provider value={textures}>
    <color attach="background" args={['#151518']} />
    <fog attach="fog" args={['#151518',40,85]} />
    <ambientLight intensity={.65} />
    <hemisphereLight args={['#f1eeee','#858080',1.35]} />
    <directionalLight position={[-7,16,9]} intensity={3.4} color="#fff0d9" castShadow shadow-mapSize={[2048,2048]} shadow-radius={3} shadow-bias={-.0003} shadow-normalBias={.04} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
    <directionalLight position={[10,7,-10]} intensity={1.2} color="#e0dbe3" />
    <Environment resolution={128}>
      <Lightformer position={[0,10,-8]} scale={[12,8,1]} intensity={1.4} color="#fff0da" />
      <Lightformer position={[10,3,0]} rotation={[0,-Math.PI/2,0]} scale={[10,5,1]} intensity={1} color="#e9e4e8" />
    </Environment>
    <mesh position={[0,-.67,0]} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[200,200]} /><shadowMaterial transparent opacity={.22} /></mesh>
    {interior ? <Interior squad={squad} areaId={areaId} selectedAgent={selectedAgent} onAgent={onAgent} onHover={onHover} accent={accent} /> : <>
      <Block at={[0,-.32,0]} size={[Math.max(23,radius*2+5),.54,Math.max(19,radius*2+3)]} color="#515156" round={.22} />
      <Block at={[0,-.035,0]} size={[Math.max(22.6,radius*2+4.6),.09,Math.max(18.6,radius*2+2.6)]} color="#92a182" kind="grass" round={.18} />
      <Block at={[0,.03,-.7]} size={[7.1,.09,5.8]} color="#bec4b3" round={.16} />
      {squads.map((item,i) => { const [x,z]=sitePosition(i,squads.length); return <Walkway key={item.id} x={x} z={z} />; })}
      <Landscaping squadCount={squads.length} />
      <Headquarters areas={areas} onEnter={onArea} onHover={onHover} />
      {squads.map((item,i) => <Pavilion key={item.id} squad={item} at={sitePosition(i,squads.length)} onEnter={() => onSquad(item.id)} onHover={onHover} />)}
    </>}
    <OrbitControls makeDefault target={interior ? [0,1.05,0] : [0,1.7,0]} enablePan={false} enableDamping minPolarAngle={.35} maxPolarAngle={1.22} minZoom={10} maxZoom={90} />
    <CameraFit interior={interior} zoomCommand={zoomCommand} />
  </Materials.Provider>;
}
