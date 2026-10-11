import { validRequest } from './validation.js';
import {getSong,updateSong} from './db.js';
import type {Song} from './types.js';
import type { Album } from './album-types.js';

// Separate DB: existing track libraries do not need a schema upgrade.
function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('yue2-albums', 1);
		request.onupgradeneeded = () => request.result.createObjectStore('albums', { keyPath: 'id' });
		request.onblocked = () => reject(new Error('Close the older Studio tab to open album storage.'));
		request.onsuccess = () => {request.result.onversionchange=()=>request.result.close();resolve(request.result);};
		request.onerror = () => reject(request.error);
	});
}
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await open();
	return new Promise((resolve, reject) => {
		const tx = db.transaction('albums', mode);
		const request = operation(tx.objectStore('albums'));
		tx.oncomplete = () => { db.close(); resolve(request.result); };
		tx.onabort = () => { db.close(); reject(tx.error || new Error('Could not save album progress')); };
		tx.onerror = () => { /* abort owns rejection and cleanup */ };
	});
}
const channel=typeof window==='undefined'||typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('yue2-albums');
channel?.addEventListener('message',()=>window.dispatchEvent(new Event('yue2-albums-changed')));
function announce(){window.dispatchEvent(new Event('yue2-albums-changed'));channel?.postMessage('changed');}
export async function saveAlbum(album: Album) { album.updated = Date.now(); await transaction('readwrite', store => store.put(album)); announce(); }
export function albumSongs(album:Album,songs:Song[]):Song[] {
 return album.tracks.flatMap(t=>{const song=songs.find(s=>t.libraryKey?s.libraryKey===t.libraryKey:s.id===t.songId);return song?[song]:[];});
}
// Caller owns the Studio lock. Membership lives in one album record; the
// stable library key survives backup restores without copying any audio.
export async function sendSongToAlbum(songId:number,albumId:string,name:string):Promise<Album>{
 const source=await getSong(songId);if(!source)throw new Error('This song is no longer in the library.');
 let song:Song=source;
 const albums=await listAlbums();
 let album=albums.find(a=>a.id===albumId);
 if(albumId&&!album)throw new Error('This album is no longer available.');
 if(!album){const title=name.trim();if(!title||title.length>150)throw new Error('Enter an album name (up to 150 characters).');
 if(albums.some(a=>a.title.toLowerCase()===title.toLowerCase()))throw new Error('An album with that name already exists. Choose it from the list.');
 album={id:crypto.randomUUID(),version:1,title,created:Date.now(),updated:Date.now(),request:song.request,visualStyle:'',artwork:false,video:false,seed:song.seed,tracks:[],status:'complete',stage:'Library collection'};}
 if(album.tracks.some(t=>t.songId===songId||(song.libraryKey&&t.libraryKey===song.libraryKey)))throw new Error('This song is already in that album.');
 if(album.tracks.length>=30)throw new Error('This album already has 30 tracks.');
 if(!song.libraryKey)song=await updateSong(songId,{libraryKey:crypto.randomUUID()});
 album.tracks.push({id:crypto.randomUUID(),title:song.name,lyrics:song.request.lyrics||'',artDirection:'',songId,libraryKey:song.libraryKey,linked:true,artDone:!!song.artwork,videoDone:!!song.video});
 await saveAlbum(album);
 // The source tab must receive the stable key too; BroadcastChannel only
 // reaches other tabs. Otherwise album membership is invisible until reload.
 window.dispatchEvent(new Event('yue2-library-changed'));
 return album;
}
export async function listAlbums(): Promise<Album[]> { return (await transaction('readonly', store => store.getAll()) as Album[]).sort((a,b) => b.updated-a.updated); }

export function validateAlbum(value:unknown):Album {
 const a=value as Album;
 if(!a||a.version!==1||typeof a.id!=='string'||typeof a.title!=='string'||typeof a.visualStyle!=='string'||!Number.isFinite(a.seed)||!Number.isFinite(a.created)||!Number.isFinite(a.updated)||typeof a.video!=='boolean'||typeof a.artwork!=='boolean'||!Array.isArray(a.tracks)||a.tracks.length>30||a.tracks.some(t=>!t||typeof t.id!=='string'||typeof t.title!=='string'||typeof t.lyrics!=='string'||typeof t.artDirection!=='string'||(t.libraryKey!==undefined&&typeof t.libraryKey!=='string')||(t.linked!==undefined&&typeof t.linked!=='boolean')))throw new Error('Invalid album plan in backup.');
 return {...a,request:validRequest(a.request),status:a.status==='complete'?'complete':'paused'};
}
export async function restoreAlbums(albums:Album[],songs:import('./types.js').Song[]) {
 for(const source of albums){const a=validateAlbum(source);a.tracks=a.tracks.map(t=>{const song=songs.find(s=>t.libraryKey?s.libraryKey===t.libraryKey:s.albumId===a.id&&s.albumTrackId===t.id);return {...t,songId:song?.id,jobId:undefined,artJobId:undefined,videoJobId:undefined,artDone:!!song?.artwork,videoDone:!!song?.video};});a.coverJobId=undefined;a.status=a.tracks.every(t=>t.songId&&(t.linked||((!(a.artwork||a.video)||t.artDone)&&(!a.video||t.videoDone))))?'complete':'paused';await saveAlbum(a);}
}
