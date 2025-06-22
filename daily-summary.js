import fs from 'fs';
import path from 'path';
import readline from 'readline';

const parseCSVLine = (line) => {
  const parts = line.split(';');
  return {
    date: parts[0],
    time: parts[1],
    tripId: parts[2],
    shortName: parts[3],
    lineName: parts[4],
    stopName: parts[5],
    plannedArrival: parts[6],
    actualArrival: parts[7],
    delayMin: parseInt(parts[8], 10),
  };
};

const main = async () => {
  const date = new Date().toISOString().slice(0, 10); // pl. 2025-06-22
  const arrivalsPath = path.resolve('arrivals.csv');

  if (!fs.existsSync(arrivalsPath)) {
    console.error('❌ Nem található arrivals.csv');
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(arrivalsPath),
    crlfDelay: Infinity,
  });

  const entries = [];
  let lineCount = 0;

  for await (const line of rl) {
    if (lineCount === 0 || !line.trim()) {
      lineCount++;
      continue; // fejléc vagy üres sor
    }

    const data = parseCSVLine(line);
    if (data.date !== date) continue; // csak a mai napot nézzük
    entries.push(data);
    lineCount++;
  }

  if (!entries.length) {
    console.log('⚠️ Nincs mai késési adat.');
    return;
  }

  const totalDelay = entries.reduce((sum, e) => sum + e.delayMin, 0);
  const averageDelay = (totalDelay / entries.length).toFixed(1);

  const lineDelays = {};
  for (const e of entries) {
    const key = (e.lineName || e.shortName || 'ismeretlen').split('/')[0]; // csak az első név maradjon
    lineDelays[key] = (lineDelays[key] || 0) + e.delayMin;
  }

  const mostDelayedLine = Object.entries(lineDelays).sort((a, b) => b[1] - a[1])[0];

  const top5 = [...entries]
    .sort((a, b) => b.delayMin - a.delayMin)
    .slice(0, 5);

  const summary = {
    date,
    totalTrains: entries.length,
    totalDelayMinutes: totalDelay,
    averageDelay: Number(averageDelay),
    mostDelayedLine: {
      name: mostDelayedLine?.[0] ?? 'ismeretlen',
      totalMinutes: mostDelayedLine?.[1] ?? 0,
    },
    top5Delays: top5.map((e) => ({
      tripId: e.tripId,
      line: (e.lineName || e.shortName).split('/')[0],
      stop: e.stopName,
      delayMin: e.delayMin,
      time: e.time,
    })),
  };

  const summaryPath = `summary-${date}.json`;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`✅ Napi összefoglaló mentve: ${summaryPath}`);
  console.table(summary);
};

main();
