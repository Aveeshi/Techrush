const express=require('express');
require('dotenv').config();
const passport=require("passport");
const GoogleStrategy=require("passport-google-oauth20").Strategy;
const path=require('path');
const { attachUserToLocals } = require('./middleware/locals');

const rootDir=require("./utils/PathUtil.js");
const eventRouter=require("./routes/Eventrouter.js");
const authRouter=require("./routes/authRouter.js");
const clubRouter=require("./routes/clubRouter.js");
const skillTagRouter=require("./routes/skillTagRouter.js");
const eventTypeRouter=require("./routes/Eventtyperouter.js");
// const errorController=require("./controller/errors.js");

const { title } = require('process');
const session=require("express-session");
const pgSession=require('connect-pg-simple')(session);
const db=require('./utils/db.js');
const multer=require('multer');
require("./config/passport.js")


const{v4:uuid}=require('uuid');

const app=express();
app.set('trust proxy', 1);
app.set('view engine','ejs');
app.set('views','views');

app.use((req,res,next)=>{
    console.log(req.url,req.method);
    next();
});

app.use(session({
    store: new pgSession({
        pool:db,
        tableName:'session',
        createTableIfMissing:true
    }),
    secret: process.env.SESSION_SECRET,
    resave:false,
    saveUninitialized:true,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));

app.use((req,res,next)=>{
    req.isLoggedIn=req.session.isLoggedIn;
    res.locals.isLoggedIn = req.isLoggedIn;
    res.locals.user = req.session.user ;
    next();
});

app.use(passport.initialize());
app.use(passport.session());
app.use(attachUserToLocals); 


app.use(express.static(path.join(rootDir,"public")));
// app.use('/uploads', express.static(path.join(rootDir, 'uploads')));
app.use(express.urlencoded());
app.use(express.json()); // needed for the scan page's fetch() POST to /events/:id/checkin

app.get('/favicon.ico', (req, res) => res.status(204).end());
// app.use("/organizer",);
// app.use("/auth",);

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});


app.use('/events', eventRouter);
app.use('/auth', authRouter);
app.use('/clubs', clubRouter);
app.use('/skill-tags', skillTagRouter);
app.use('/event-types', eventTypeRouter);
app.use("/",(req,res)=>{
    res.render('index');
});
// app.use(errorController.pageNotFound);


const PORT=9000;
app.listen(PORT,()=>{
    console.log(`Server running on address http://localhost:${PORT}`);
})