require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
const mysql = require("mysql");

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
    return;
  }
  console.log("Connected to the database");
});

const getLatestDateTimeQuery =
  "SELECT date, time FROM radio_songs ORDER BY date DESC, time DESC LIMIT 1";

const getLatestDateTime = async () => {
  return new Promise((resolve, reject) => {
    db.query(getLatestDateTimeQuery, (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve({ date: results[0].date, time: results[0].time });
      }
    });
  });
};

// Function to format date as YYYY-MM-DD
const formatDate = (date) => {
  return date.toISOString().split("T")[0];
};

const checkAndInsertSong = async (song) => {
  const query = "SELECT * FROM radio_songs WHERE date = ? AND time = ?";
  const existingRecords = await new Promise((resolve, reject) => {
    db.query(query, [song.date, song.time], (err, results) => {
      if (err) {
        reject(err);
      } else {
        resolve(results);
      }
    });
  });

  if (existingRecords.length === 0) {
    // No duplicate, insert new record
    const insertQuery = "INSERT INTO radio_songs SET ?";
    await new Promise((resolve, reject) => {
      db.query(insertQuery, song, (insertErr, insertResult) => {
        if (insertErr) {
          reject(insertErr);
        } else {
          resolve(insertResult);
          console.log(
            song.date + " " + song.time + ` Inserted song: ${song.title}`
          );
        }
      });
    });
  } else {
    console.log(`Duplicate found, not inserting: ${song.title}`);
  }
};

const fetchDataForDateTime = async (date, hour) => {
  const url = `https://www.n-joy.de/radio/titelsuche118_date-${date}_hour-${hour}.html`;

  console.log(url);
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const songs = [];

    // Traverse the HTML and extract data
    $("li.program").each((i, elem) => {
      const time = $(elem).find(".time").text().trim();
      const artist = $(elem).find(".artist").text().trim();
      const title = $(elem).find(".title").text().trim();
      const cover_url =
        "https://www.n-joy.de/" + $(elem).find(".thumbnail img").attr("src");
      songs.push({ date, time, artist, title, cover_url });
    });

    // Insert data into the database
    for (const song of songs) {
      await checkAndInsertSong(song);
    }
  } catch (error) {
    console.error("Error fetching data:", error); // Handle errors here
  }
  console.log("Done fetching data for " + date + " " + hour); // Success!
};

const fetchData = async () => {
  const latestDateTimeInDB = await getLatestDateTime();

  // Create a new Date object using the date from the database
  let currentDateTime = new Date(latestDateTimeInDB.date);

  // Split the time string into hours and minutes
  const [hours, minutes] = latestDateTimeInDB.time.split(":").map(Number);

  // Set the hours and minutes of the date object
  currentDateTime.setHours(hours, minutes, 0, 0);

  while (currentDateTime <= new Date()) {
    const date = formatDate(currentDateTime);
    const hour = currentDateTime.getHours().toString().padStart(2, "0");

    await fetchDataForDateTime(date, hour);

    // Move to the next hour
    currentDateTime.setHours(currentDateTime.getHours() + 1);
  }
};

module.exports = fetchData;
