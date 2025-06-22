import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function gitCommitAndPush(filePath) {
  try {
    execSync(`git config --global user.email "cron@vonatkeses.hu"`);
    execSync(`git config --global user.name "VonatKésés Bot"`);

    execSync(`git add ${filePath}`);
    execSync(`git commit -m "♻️ Auto-update at ${new Date().toISOString()}"`);
    execSync(`git push https://${process.env.GITHUB_TOKEN}@github.com/kubsubs/vonatkeses.git HEAD:main`);
    console.log("✅ Git push sikeres!");
  } catch (err) {
    console.error("❌ Git push hiba:", err.message);
  }
}

const gql = async (query, variables = {}) => {
  const res = await fetch('https://emma.mav.hu/otp2-backend/otp/routers/default/index/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
};

const formatTime = (unix) =>
  unix
    ? new Date(unix * 1000).toLocaleTimeString('hu-HU', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const main = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const day = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(':', '');

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const midnightTimestamp = Math.floor(midnight.getTime() / 1000);

  // 🔍 országos bbox
  const query = `
    {
      vehiclePositions(
        swLat: 45.7,
        swLon: 16.0,
        neLat: 48.7,
        neLon: 23.0,
        modes: [RAIL]
      ) {
        vehicleId
        lat
        lon
        speed
        heading
        label
        lastUpdated
        stopRelationship {
          status
          arrivalTime
          stop {
            name
          }
        }
        trip {
          id
          tripHeadsign
          tripShortName
          routeShortName
          route {
            longName
            mode
          }
        }
      }
    }
  `;

  const { data } = await gql(query);
  const vehicles = data?.vehiclePositions ?? [];

  if (!vehicles.length) {
    console.log('⚠️  Nincs aktív vonat.');
    return;
  }

  const folder = `data/${day}`;
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, `${time}.json`);
  fs.writeFileSync(filePath, JSON.stringify(vehicles, null, 2));

  const arrivalsPath = 'arrivals.csv';
  const savedTripsPath = 'data/.seenTrips.json';

  let seenTrips = {};
  if (fs.existsSync(savedTripsPath)) {
    seenTrips = JSON.parse(fs.readFileSync(savedTripsPath, 'utf8'));
  }

  const lines = [];

  for (const v of vehicles) {
    const tripId = v.trip?.id;
    if (!tripId || seenTrips[tripId]) continue;

    const stop = v.stopRelationship?.stop?.name ?? '';
    const arrival = v.stopRelationship?.arrivalTime;
    const status = v.stopRelationship?.status;

    // Csak akkor mentjük, ha állomásnál áll vagy oda tart
    if (status !== 'STOPPED_AT' && status !== 'INCOMING_AT') continue;

    const planned = midnightTimestamp + (arrival || 0);
    const actual = v.lastUpdated;
    const delayMin = Math.max(0, Math.round((actual - planned) / 60));

    const line = [
      day,
      time,
      tripId,
      v.trip?.tripShortName || '',
      v.trip?.route?.longName || '',
      stop,
      formatTime(planned),
      formatTime(actual),
      delayMin,
    ];

    lines.push(line.join(';'));
    seenTrips[tripId] = true;
  }

  if (lines.length) {
    const csvHeader = !fs.existsSync(arrivalsPath)
      ? 'date;time;tripId;shortName;lineName;stopName;plannedArrival;actualArrival;delayMin\n'
      : '';

    fs.appendFileSync(arrivalsPath, csvHeader + lines.join('\n') + '\n');
    fs.writeFileSync(savedTripsPath, JSON.stringify(seenTrips, null, 2));
    console.log(`✅ Mentve ${lines.length} késés adat.`);
  } else {
    console.log('📭 Nem volt új késés.');
  }
  
  execSync('node daily-summary.js');
  const summaryFile = `summary-${day}.json`;
  execSync(`git add ${summaryFile}`);
  gitCommitAndPush('.');

};

main();
