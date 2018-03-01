/* eslint class-methods-use-this:
[ "error",
  {"exceptMethods": [
    "isString",
    "isArray",
    "throwIfMissing",
    "getMetadata",
    "setMetadata",
    "getTrackWithFormat",
    "fillMetadataToMp3"
  ]}
] */

import LastFM from 'last-fm';
import ffmetadata from 'ffmetadata';
import fs from 'fs';
import path from 'path';
import zip from 'file-zip';
import zipdir from 'zip-dir';
import log4js from '../lib/logger';
import { getFilesFromFolder } from './util';

const fileName = path.basename(__filename, path.extname(__filename));
const logger = log4js.getLogger(fileName);

class ConvertItunes {
  constructor(
    apiKey = this.throwIfMissing(),
    extensions = this.throwIfMissing(),
    mp3Files = this.throwIfMissing(),
    path = this.throwIfMissing(),
    pathItunes = this.throwIfMissing()
  ) {
    this.isString(apiKey);
    this.isArray(mp3Files);
    this.lastFM = new LastFM(apiKey, 'MyApp/1.0.0 (http://example.com)');
    this.mp3Files = mp3Files;
    this.extensions = extensions;
    this.path = path;
    this.pathItunes = pathItunes;
    this.albumInfo = [];
    this.thumbnail = '';
    this.artist = '';
    this.album = '';
  }

  /**
    * It is a getter, should show all params
  */
  get getAttributes() {
    return `ApiKey: ${this.apiKey} | mp3Files: ${this.mp3Files}!`;
  }

  /**
    * It is a setter for mp3Files path
    * @param {string} mp3Files path
  */
  set changeMp3Files(mp3Files) {
    this.mp3Files = mp3Files;
  }

  /**
    * It is a setter for apiKey
    * @param {string} api key of last.fm api.
  */
  set changeApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  /**
    * Check if params is an array
    * @param {any} value be a arrauy
  */
  isArray(obj) {
    if (!(!!obj && obj.constructor === Array)) {
      throw 'Wrong type parameter.';
    }
  }

  /**
    * Check if params is a string
    * @param {any} value be a string
  */
  isString(value) {
    if (typeof value !== 'string' && !(value instanceof String)) {
      throw 'Wrong type parameter.';
    }
  }

  /**
    * Set default error if parameter is missing
  */
  throwIfMissing() {
    throw 'Missing parameter.';
  }

  /**
    * Get mp3 metadata.
    * @param {string} file path (eg. /path/to/song.mp3)
  */

  getMetadata(file) {
    return new Promise((resolve, reject) => {
      ffmetadata.read(file, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  /**
    * Write metadata to an mp3 file.
    * @param {string} file path (eg. /path/to/song.mp3)
  */

  setMetadata(file, metadata, options) {
    return new Promise((resolve, reject) => {
      ffmetadata.write(file, metadata, options, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }

  /**
    * Format file path as track name.
    * @param {string} file path (eg. /path/to/song.mp3)
  */

  getTrackWithFormat(file) {
    const lastDot = file.lastIndexOf('.');
    // @slorenzo: remove string between paretheses.
    let track = file.split('-').pop().substring(0, lastDot).replace(/\([^()]*\)/g, '').split('.')[0];
    const firstDigit = track.match(/(\d+)/);
    if (firstDigit && firstDigit !== -1) {
      // @slorenzo: remove numbers.
      const regex = new RegExp(firstDigit[0], 'g');
      track = track.replace(regex, '');
    }
    // @slorenzo: remove accents.
    return track.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); 
  }


  trackInfo(title, artist) {
    return new Promise((resolve, reject) => {
      this.lastFM.trackInfo({
        name: title,
        artistName: artist,
      }, (err, data) => {
        if(err) {
          reject(err);
        } else {
          resolve(data); 
        }
      });
    });
  }

  /**
    * Search track in LastFM API and filling this data on metadata of mp3.
    * @param {array} paths of mp3 files (eg. /path/to/song.mp3)
    * @param {fillMetadataToMp3~requestCallback} callbackEnd
  */

  async fillAlbumInfo() {
    await Promise.all(this.mp3Files.map(async (mp3, index) => {
      const path = `${this.path}/${mp3}`;
      try {
        const metadata = await this.getMetadata(path);
        const track = this.getTrackWithFormat(mp3);
        const info = await this.trackInfo(metadata.title || track, metadata.artist);

        this.albumInfo.push({
          title: metadata.title || track,
          artist: info.artistName,
          album: info.albumName || null,
          thumbnail: info.images && info.images[info.images.length - 1],
          position: info.position
        });
      } catch(err) {
        logger.error(err);
        throw err;
      }
    }));
  }

  async fillSpecificInfoFromAlbumInfo() {
    this.albumInfo = this.albumInfo.sort((a, b) => {
      return a.position - b.position
    });

    const thumbnail = this.albumInfo.map(track => track.thumbnail)
    const artist = this.albumInfo.map(track => track.artist);
    const album = this.albumInfo.map(track => track.album);

    this.thumbnail = this.findMostCommondValue(thumbnail);
    this.artist = this.findMostCommondValue(artist);
    this.album = this.findMostCommondValue(album);
  }

  findMostCommondValue(arr) {
    const tally = (acc, x) => { 
      if (! acc[x]) { 
        acc[x] = 1;
        return acc;
      } 
      acc[x] += 1;
      return acc;
    };

    const totals = arr.reduce(tally, {});

    const keys = Object.keys(totals);

    const values = keys.map(x => totals[x]);

    const results = keys.filter(x => totals[x] === Math.max(...values));

    return results;
  }


  async fillMetada() {
    for(let trackInfo of this.albumInfo) {
      for (let file of this.mp3Files) {

        const title  = this.formatStringToCompare(trackInfo.title);
        const trackName = this.formatStringToCompare(this.fillTrackName(file));

        if(trackName.includes(title)) {
          const filePath = `${this.path}/${file}`;
          
          const metadata = {
            title: trackInfo.title,
            artist: this.artist[0],
            album: this.album[0],
            track: trackInfo.position,
            comment: 'Apple Lossless created by mp3-to-itunes.com',
          };

          let options = {
            attachments: [...this.thumbnail]
          };

          try {
            await this.setMetadata(filePath, metadata, options);  
          } catch(err) {
            logger.error(err);
            throw err;
          }
        }
      }
    }
  }

  async createZipFile() {
    try{
      await this.zipFolder();
    } catch(err) {
      logger.error(err);
      throw err;
    }
  }

  zipFolder() {
    return new Promise((resolve, reject) => {
      !fs.existsSync(this.pathItunes) && fs.mkdirSync(this.pathItunes);
      zipdir(this.path, { saveTo: `${this.pathItunes}/${this.album[0]}.zip` }, function (err, buffer) {
        if(err) {
          reject(err);
        } else {
          resolve(buffer);
        }
      });
    });
  }

  fillTrackName(fileName) {
    const map = this.fillMapWith();
    const tracksName = this.strReplaceMap(fileName, map);
    
    return tracksName;
  }

  strReplaceMap(str, map) {
    const field = Object.keys(map);
    for (let search of field) {
      str = str.replace(search, map[search]);
    }

    return str;
  }

  fillMapWith() {
    let map = {};
    for (let extension of this.extensions) {
      map[`.${extension}`] = '';
    }

    return map;
  }

  formatStringToCompare(str) {
    return str.toLowerCase().replace(/ /g,'').replace(/'/g, '').replace(/-/g, '');
  }

  /**
    * It is a module initialize
    * @param {init~requestCallback} callback
  */
  async init(callback) {
    await this.fillAlbumInfo();
    await this.fillSpecificInfoFromAlbumInfo();
    await this.fillMetada();
    await this.createZipFile();
  }
}

export default ConvertItunes;