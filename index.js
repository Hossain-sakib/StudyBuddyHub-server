const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// middlewares
app.use(
  cors({
    origin: [
      "https://study-buddy-hub.web.app/",
      "https://study-buddy-hub.firebaseapp.com/",
      "http://localhost:5173",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// own  middlewares
const logger = (req, res, next) => {
  console.log("log: info", req.method, req.url);
  next();
};

const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xpzeqy0.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    const assignmentCollection = client
      .db("assignmentsDB")
      .collection("assignments");
    const submittedAssignmentCollection = client
      .db("assignmentsDB")
      .collection("submittedAssignments");

    // all assignments
    // get all assignment
    app.get("/assignments", async (req, res) => {
      const cursor = assignmentCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // get specific assignment
    app.get("/assignments/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assignmentCollection.findOne(query);
      res.send(result);
    });

    // create assignment
    app.post("/assignments", async (req, res) => {
      const newAssignment = req.body;
      console.log(newAssignment);
      const result = await assignmentCollection.insertOne(newAssignment);
      res.send(result);
    });

    // update assignment
    app.put("/assignments/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedAssignment = req.body;
      const userEmail = updatedAssignment.email;
      const assignment = await assignmentCollection.findOne(filter);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }
      if (assignment.email !== userEmail) {
        return res.status(403).json({
          message: "Unauthorized: You are not the creator of this assignment",
        });
      }
      const assignmentUpdate = {
        $set: {
          title: updatedAssignment.title,
          thumbnailURL: updatedAssignment.thumbnailURL,
          marks: updatedAssignment.marks,
          description: updatedAssignment.description,
          difficultyLevel: updatedAssignment.difficultyLevel,
          dueDate: updatedAssignment.dueDate,
          email: userEmail,
        },
      };

      const result = await assignmentCollection.updateOne(
        filter,
        assignmentUpdate
      );
      res.send(result);
    });

    // delete specific assinment
    app.delete("/assignments/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const userEmail = req.body.email;
      const assignment = await assignmentCollection.findOne(query);
      if (!assignment) {
        // Assignment not found.
        return res.status(404).json({ message: "Assignment not found" });
      }
      if (assignment.email !== userEmail) {
        return res.status(403).json({
          message: "Unauthorized: You are not the creator of this assignment",
        });
      }
      const result = await assignmentCollection.deleteOne(query);
      res.send(result);
    });

    // submitted assignment

    // post submit
    app.post("/submittedassignments", async (req, res) => {
      const item = req.body;
      console.log(item);
      const result = await submittedAssignmentCollection.insertOne(item);
      res.send(result);
    });

    // get specific submit
    app.get("/submittedassignments", async (req, res) => {
      let query = {};
      if (req.query?.email) {
        query = { email: req.query.email };
      }
      const result = await submittedAssignmentCollection.find(query).toArray();
      res.send(result);
    });

    app.patch("/submittedassignments/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const markAssignment = req.body;
      const updateDoc = {
        $set: {
          status: markAssignment.status,
          givenMark: markAssignment.givenMark,
          feedback: markAssignment.feedback,
        },
      };
      const result = await submittedAssignmentCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });

    // auth
    app.post("/jwt", logger, async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });

      res
        .cookie("token", token, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
        })
        .send({ success: true });
    });

    app.post("/logout", async (req, res) => {
      const user = req.body;
      console.log("logging out", user);
      res.clearCookie("token", { maxAge: 0 }).send({ success: true });
    });

    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is running");
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
