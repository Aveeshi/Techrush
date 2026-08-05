const {Pool, Client}=require('pg');
require('dotenv').config();

const db= new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:{
        rejectUnauthorized:false
    }
});

db.connect((err,client,release)=>{
    if(err){
        console.error('DB connection failed',err.message);
    }
    else{
        console.log('Connected to Supabase PostgresSQL');
    }
});

module.exports=db;