const express = require("express");
const mysql = require("mysql");
const ejs = require("ejs");
const fs = require("fs");
const https = require("https");
const path = require("path");

require("dotenv").config();

const fetchData = require("./fetchData"); // Import fetchData

const app = express();
app.use(express.static("public"));
app.set("view engine", "ejs");

// Database connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err);
    return; // Exit early
  }
  console.log("Connected to the database");
});

// Function to format date as YYYY-MM-DD
const formatDate = (date) => {
  return date.toISOString().split("T")[0];
};

// Routes
app.get("/", (req, res) => {
  let timeRange = req.query.time_range || "last_7_days";
  let fromDate, toDate;

  switch (timeRange) {
    case "last_day":
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 1);
      toDate = new Date();
      break;
    case "last_7_days":
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      toDate = new Date();
      break;
    case "last_30_days":
      fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - 1);
      toDate = new Date();
      break;
    case "last_year":
      fromDate = new Date();
      fromDate.setFullYear(fromDate.getFullYear() - 1);
      toDate = new Date();
      break;
    case "custom":
      fromDate = new Date(req.query.from_date);
      toDate = new Date(req.query.to_date);
      break;
    default:
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      toDate = new Date();
  }

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    // Handle invalid date
    return res.status(400).send("Invalid date range");
  }

  fromDate = formatDate(fromDate);
  toDate = formatDate(toDate);

  let limit = 100;
  let offset = req.query.offset ? parseInt(req.query.offset) : 0;

  let query =
    "SELECT title, artist, cover_url, COUNT(*) as play_count FROM radio_songs WHERE date BETWEEN ? AND ? GROUP BY title, artist ORDER BY play_count DESC LIMIT ? OFFSET ?";

  db.query(query, [fromDate, toDate, limit, offset], (err, results) => {
    if (err) throw err;
    if (req.query.ajax) {
      res.json(results); // Send JSON response for AJAX request
    } else {
      res.render("index", {
        songs: results,
        offset: offset + limit,
        timeRange: timeRange,
        fromDate: req.query.from_date || "",
        toDate: req.query.to_date || "",
      });
    }
  });
});

app.get("/webcams/:number", async (req, res) => {
  const { number } = req.params;
  const dir = `public/webcam${number}`;
  const files = fs.readdirSync(dir);
  const images = files.map((file) => {
    return `../webcam${number}/${file}`;
  });
  res.render("webcams", { images });
  console.log(images);
});

app.get("/song/:title/:artist", async (req, res) => {
  const { title, artist } = req.params;

  const songDetailsQuery =
    "SELECT * FROM radio_songs WHERE title = ? AND artist = ? ORDER BY date DESC, time DESC LIMIT 1";
  const playCountByHourQuery =
    "SELECT SUBSTRING(time, 1, 2) as hour, COUNT(*) as play_count FROM radio_songs WHERE title = ? AND artist = ? GROUP BY hour ORDER BY hour";
  const playCountByMinuteQuery =
    "SELECT SUBSTRING(time, 4, 5) as Minute, COUNT(*) as play_count FROM radio_songs WHERE title = ? AND artist = ? GROUP BY Minute ORDER BY Minute";

  const playCountByDayOfWeekQuery = `
    SELECT DAYNAME(date) as day_of_week, COUNT(*) as play_count 
    FROM radio_songs 
    WHERE title = ? AND artist = ? 
    GROUP BY day_of_week 
    ORDER BY FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')`;

  const playCountPerDayQuery = `
    SELECT date, COUNT(*) as play_count 
    FROM radio_songs 
    WHERE title = ? AND artist = ? 
    GROUP BY date 
    ORDER BY date`;

  try {
    const playCountByDayOfWeek = await new Promise((resolve, reject) => {
      db.query(playCountByDayOfWeekQuery, [title, artist], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    const songDetails = await new Promise((resolve, reject) => {
      db.query(songDetailsQuery, [title, artist], (err, results) => {
        if (err) reject(err);
        resolve(results[0]);
      });
    });

    const playCountByHour = await new Promise((resolve, reject) => {
      db.query(playCountByHourQuery, [title, artist], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    const playCountByMinute = await new Promise((resolve, reject) => {
      db.query(playCountByMinuteQuery, [title, artist], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    // Prepare data for Chart.js
    const hours = Array.from({ length: 24 }, (_, i) =>
      i.toString().padStart(2, "0")
    );
    const playCountsHour = hours.map((hour) => {
      const hourData = playCountByHour.find((d) => d.hour === hour);
      return hourData ? hourData.play_count : 0;
    });

    const minute = Array.from({ length: 60 }, (_, i) =>
      i.toString().padStart(2, "0")
    );
    const playCountsMinute = minute.map((Minute) => {
      const MinuteData = playCountByMinute.find((d) => d.Minute === Minute);
      return MinuteData ? MinuteData.play_count : 0;
    });

    const day = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    const playCountsByDayOfWeek = day.map((day) => {
      const dayData = playCountByDayOfWeek.find((d) => d.day_of_week === day);
      return dayData ? dayData.play_count : 0;
    });

    // Additional statistics
    const currentDate = new Date();
    const startOfWeek = new Date(
      currentDate.setDate(currentDate.getDate() - currentDate.getDay())
    );
    const thirtyDaysAgo = new Date(
      new Date().setDate(new Date().getDate() - 30)
    );
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);

    const playCountThisWeekQuery =
      "SELECT COUNT(*) as play_count FROM radio_songs WHERE title = ? AND artist = ? AND date >= ?";
    const playCountLast30DaysQuery =
      "SELECT COUNT(*) as play_count FROM radio_songs WHERE title = ? AND artist = ? AND date >= ?";
    const playCountThisYearQuery =
      "SELECT COUNT(*) as play_count FROM radio_songs WHERE title = ? AND artist = ? AND date >= ?";

    const playCountThisWeek = await new Promise((resolve, reject) => {
      db.query(
        playCountThisWeekQuery,
        [title, artist, startOfWeek],
        (err, results) => {
          if (err) reject(err);
          resolve(results[0].play_count);
        }
      );
    });

    const playCountLast30Days = await new Promise((resolve, reject) => {
      db.query(
        playCountLast30DaysQuery,
        [title, artist, thirtyDaysAgo],
        (err, results) => {
          if (err) reject(err);
          resolve(results[0].play_count);
        }
      );
    });

    const playCountThisYear = await new Promise((resolve, reject) => {
      db.query(
        playCountThisYearQuery,
        [title, artist, startOfYear],
        (err, results) => {
          if (err) reject(err);
          resolve(results[0].play_count);
        }
      );
    });

    const playCountPerDay = await new Promise((resolve, reject) => {
      db.query(playCountPerDayQuery, [title, artist], (err, results) => {
        if (err) reject(err);
        resolve(results);
      });
    });

    // After fetching playCountPerDay
    const firstPlayDate =
      playCountPerDay.length > 0
        ? new Date(playCountPerDay[0].date)
        : new Date();
    firstPlayDate.setDate(firstPlayDate.getDate() - 5); // Set to 5 days before the first play

    const lastDate = new Date(); // Today's date

    const dateMap = new Map();
    playCountPerDay.forEach((row) => {
      const formattedDate = new Date(row.date).toISOString().split("T")[0];
      dateMap.set(formattedDate, row.play_count);
    });

    const allDates = [];
    const allPlayCounts = [];
    for (
      let d = new Date(firstPlayDate);
      d <= lastDate;
      d.setDate(d.getDate() + 1)
    ) {
      const formattedDate = d.toISOString().split("T")[0];
      allDates.push(formattedDate);
      const playCount = dateMap.get(formattedDate);
      allPlayCounts.push(playCount !== undefined ? playCount : 0);
    }

    res.render("song-details", {
      song: songDetails,
      chartDataHour: { labels: hours, playCounts: playCountsHour },
      chartDataMinute: { labels: minute, playCounts: playCountsMinute },
      chartDataDay: { labels: day, playCounts: playCountsByDayOfWeek },
      chartDataPerDay: { labels: allDates, playCounts: allPlayCounts },

      stats: {
        playCountThisWeek,
        playCountLast30Days,
        playCountThisYear,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

function downloadwebcams() {
  const urls = [
    "https://www.n-joy.de/public/webcams/njoy/cam3.jpg",
    "https://www.n-joy.de/public/webcams/njoy/cam2.jpg",
    "https://www.n-joy.de/public/webcams/njoy/cam1.jpg",
  ];

  urls.forEach((url, i) => {
    const timestamp = Date.now();
    const dir = `public/webcam${i + 1}`;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filename = path.join(dir, `${timestamp}.jpg`);
    downloadImage(url, filename);
  });
}

function downloadImage(url, filename) {
  https
    .get(url, (res) => {
      const fileStream = fs.createWriteStream(filename);
      res.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close();
        console.log("Downloaded file:", filename);
      });
    })
    .on("error", (e) => {
      console.error(`Got error: ${e.message}`);
    });
}

setInterval(fetchData, 300000);
setInterval(downloadwebcams, 150000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on localhost:${PORT}`);
  fetchData();
  downloadwebcams();
});
