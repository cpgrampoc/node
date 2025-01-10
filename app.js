const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const { Configuration, OpenAIApi,OpenAI } = require('openai');
const natural = require('natural');
const cors = require('cors');
require('dotenv').config();
// import { Configuration, OpenAIApi } from 'openai';

// const configuration = new Configuration({
//     apiKey: process.env.OPENAI_API_KEY,
//   });
  const openai = new OpenAI({
    api_key: process.env.OPENAI_API_KEY
  });
  
//   new OpenAIApi(configuration);
const app = express();
app.use(bodyParser.json());

// Allow CORS for all origins or specific origins
app.use(cors({
    origin: 'http://localhost:4200', // Replace with your Angular app's URL
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'], // Adjust based on your needs
  }));

// PostgreSQL connection
const pool = new Pool({
  user: 'cpgram_poc',
  host: '13.203.120.124',
  database: 'cpgrampoc_db',
  password: 'cpgram@321',
  port: 5432,
});

const documents = [
    { id: 1, text: "Learn Node.js for backend development" },
    { id: 2, text: "Angular is great for frontend development" },
    { id: 3, text: "Natural Language Processing is powerful" }
  ];

  // Simple NLP tokenizer
const tokenizer = new natural.WordTokenizer();

// OpenAI setup (optional)


  const generateEmbeddingsAndInsert = async () => {
    try {
      const res = await pool.query('SELECT id, description FROM m_cpgram_categories');
      console.log(`Found ${res.rows.length} rows for embeddings generation...`);
      for (const row of res.rows) {
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-ada-002',
            input: row.description,
          });

          if (embeddingResponse.data && embeddingResponse.data[0] && embeddingResponse.data[0].embedding) {
            const embeddingArray  = embeddingResponse.data[0].embedding;

            // Format the embedding as a PostgreSQL-compatible array
            const embeddingString = `[${embeddingArray.join(', ')}]`;
  
            // Store the embedding in the database
            await pool.query('UPDATE m_cpgram_categories SET embedding = $1 WHERE id = $2', [embeddingString, row.id]);
            console.log(`Successfully stored embedding for ID: ${row.id}`);
          } else {
            console.error(`No embedding returned for ID: ${row.id}`);
          }
  
        // const embedding = embeddingResponse.data.data[0].embedding;
  
        // Store embedding in the database
        // await pool.query('UPDATE m_cpgram_categories SET embedding = $1 WHERE id = $2', [embedding, row.id]);
      }
  
      console.log('Embeddings generated and stored!');
    } catch (error) {
      console.error('Error generating embeddings:', error);
    }
  };
  
//   generateEmbeddingsAndInsert();


async function searchDocuments(queryEmbedding, limit = 25) {
    try {
        const similarityThreshold = 0.8; // Define a similarity threshold (1 - distance)
        const result = await pool.query(
          `select id, code, description,parent,stage,field_details,monitoringcode, 1 - (embedding <=> $1) AS rank from m_demo_cpgram_categories mdcc 
            where stage=3 and parent in (select id from m_demo_cpgram_categories mdcc 
            where stage=2 and parent in (select id from m_demo_cpgram_categories mdcc where stage=1
            order by embedding <=> $1 limit 3)
            order by embedding <=> $1 limit 3)
            order by embedding <=> $1 limit 5`,
            [queryEmbedding]
            // `SELECT id, code, description,parent,stage,field_details,monitoringcode, 1 - (embedding <=> $1) AS rank
            //     FROM m_demo_cpgram_categories 
            //     WHERE embedding <=> $1 < $2
            //     ORDER BY rank DESC
            //     LIMIT 5`,
            // [queryEmbedding, 1-similarityThreshold]
        );
        const combinedResults = [];
        for (const row of result.rows) {
            const secondQueryResult = await pool.query(
                `SELECT id, code, description,parent,stage,field_details,monitoringcode
                    FROM m_demo_cpgram_categories WHERE id = $1`,
                [row.parent]
            );
            for (const row1 of secondQueryResult.rows) {
                const thirdQueryResult = await pool.query(
                    `SELECT id, code, description,parent,stage,field_details,monitoringcode
                        FROM m_demo_cpgram_categories WHERE id = $1`,
                    [row1.parent]
                );
                // Combine data from the first and second queries

                combinedResults.push({
                    stage_3_details: row,
                    stage_2_details: secondQueryResult.rows,
                    stage_1_details: thirdQueryResult.rows,
                });
            }
            
        }
        return combinedResults;
    } catch (error) {
        console.error('Error running queries:', error);
        throw error; // Ensure errors are propagated
    }
  }
  async function generateEmbedding(text) {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text,
    });
    if (response.data && response.data[0] && response.data[0].embedding) {
        const embeddingArray  = response.data[0].embedding;
        const embeddingString = `[${embeddingArray.join(', ')}]`;
        // console.log("embeddingString==",embeddingString)
        // await pool.query('insert into test_embeddings_new (details, embedding_text) values($1, $2)', [text,embeddingString]);
        return embeddingString;
        // Format the embedding as a PostgreSQL-compatible array
        // const embeddingString = `[${embeddingArray.join(', ')}]`;

        // Store the embedding in the database
        // await pool.query('UPDATE m_cpgram_categories SET embedding = $1 WHERE id = $2', [embeddingString, row.id]);
        // console.log(`Successfully stored embedding for ID: ${row.id}`);
      } else {
        console.error(`No embedding returned for ID: ${row.id}`);
      }
    
  }


  async function handleSearch(query) {
    const queryEmbedding = await generateEmbedding(query);
    const results = await searchDocuments(queryEmbedding);
    return results;
  }
app.post('/search', async (req, res) => {
    const { query } = req.body;
    const results = await handleSearch(query);
    res.send(results);
});

// Handle chatbot messages
app.post('/chat', async (req, res) => {
  const { userId, message } = req.body;

  try {
    // Generate a response (OpenAI GPT example)
    const aiResponse = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: message }],
    });

    const botResponse = aiResponse.data.choices[0].message.content;

    // Store chat in PostgreSQL
    await pool.query(
      `INSERT INTO chat_history (user_id, message, response) VALUES ($1, $2, $3)`,
      [userId, message, botResponse]
    );

    // Send bot response
    res.json({ response: botResponse });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating response');
  }
});

async function insertIntoOnboardTable(onboardDemoDTO) {
    let embeddingArray = await generateEmbedding(onboardDemoDTO?.description)
    const query = `
        INSERT INTO m_demo_cpgram_categories (monitoringcode, description,
        orgcode,stage,parent,descriptionhindi,mappingcode,fieldcode,
        destination,isactive,field_details,code,embedding) VALUES ($1, $2, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *;  -- Return all columns of the newly inserted row`;
    const values = [onboardDemoDTO.monitoringcode?.id, onboardDemoDTO?.description,
        onboardDemoDTO?.orgcode,
        onboardDemoDTO?.stage,
        onboardDemoDTO?.parentId,
        onboardDemoDTO?.descriptionhindi,
        onboardDemoDTO?.mappingcode,
        onboardDemoDTO?.fieldcode,
        onboardDemoDTO?.destination,
        onboardDemoDTO?.isactive,
        onboardDemoDTO?.fieldDetails,
        onboardDemoDTO?.code,
        embeddingArray];
    const result = await pool.query(query, values);
    // console.log("result===",result)
    return result.rows[0];
}
function generateUniqueIdWithRandomness() {
  const now = new Date();
  const timestamp = now.getTime(); // Milliseconds since 1970
  const randomPart = Math.floor(Math.random() * 100000); // Random number
  return `GR-${timestamp}`;
}
async function insertIntoGrievanceTable(data) {
  let combinedResult = {}
    const query = `
        INSERT INTO t_cpgram_grievance_new (description_en,description_other,raised_by,mobile_no,assign_by,assign_to,status,
        grievance_id,field_1,tracking_link,deptid,country,state,district,address,address_2,pincode,gender,email_id,name)
        VALUES ($1, $2, $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        RETURNING *;  -- Return all columns of the newly inserted row`;
    const values = [data.description_en, data?.description_other,data?.raised_by,
            data?.mobileNo,data?.assign_by,data?.assign_to,'Pending',generateUniqueIdWithRandomness(),
            JSON.stringify(data?.field_details),'',data?.deptid,data?.country,data?.state,data?.district,data?.address,data?.address2,
            data?.pinCode,data?.gender,data?.emailId,data?.name];
    const result = await pool.query(query, values);
    // console.log("result===",result)
    let workflowRes = [];
    let notificationRes = [];
    if(result.rows[0]?.id) {
      const query1 = `
        INSERT INTO t_grievance_workflow (assign_by,assign_to,status,comments,action,grievance_id)
        VALUES ($1, $2, $3,$4,$5,$6)
        RETURNING *;  -- Return all columns of the newly inserted row`;
    const values1 = [data?.assign_by,data?.assign_to,'Pending','','Create',result.rows[0]?.id];
    workflowRes = await pool.query(query1, values1);

    const query2 = `
        INSERT INTO t_cpgram_notfication (description,is_seen,grievance_id)
        VALUES ($1,$2, $3)
        RETURNING *;  -- Return all columns of the newly inserted row`;
    const values2 = ['Grievance raised',false,result.rows[0]?.id];
    notificationRes = await pool.query(query2, values2);
    }
    combinedResult = {
      grievaneData : result.rows[0],
      workflowData : workflowRes?.rows[0],
      notificationRes: notificationRes?.rows[0]
    }
    return combinedResult;
}
async function getGrievanceTableData(data) {
  try{
    let result=[];
    if(data?.userId) {
       if(data?.grievanceId) {
        result = await pool.query(
          `SELECT *
              FROM t_cpgram_grievance_new WHERE id = $1 AND raised_by = $2 order by created_at desc`,
          [data?.grievanceId,data?.userId]
        )
      } else {
        result = await pool.query(
          `SELECT * FROM t_cpgram_grievance_new WHERE raised_by = $1 order by created_at desc`,
          [data?.userId]
        )
      }
    } else if(data?.grievanceId) {
      result = await pool.query(
        `SELECT *
            FROM t_cpgram_grievance_new WHERE grievance_id = $1 order by created_at desc`,
        [data?.grievanceId]
      )
    }else if(data?.assign_to) {
      result = await pool.query(
        `SELECT * FROM t_cpgram_grievance_new WHERE assign_to = $1 order by created_at desc`,
        [data?.assign_to]
      )
    } else if(data?.user_type=='Nodal') {
      result = await pool.query(
        `select * from t_cpgram_grievance_new tcgn where deptid in (select id from m_demo_cpgram_categories mdcc where orgcode = $1) order by created_at desc`,
        [data?.orgcode]
      )
    }else if(data?.user_type=='Super Admin') {
      result = await pool.query(
        `select * from t_cpgram_grievance_new tcgn order by created_at desc`
      )
    }
    return result?.rows;
  } catch(error){

  }
}

app.post('/cpgram-application-service/onboard/process', async (req, res) => {
    const { onboardDemoDTO } = req.body;
  
    try {
        let combinedResult = {}
      if(onboardDemoDTO) {
        if(!onboardDemoDTO.id) {
            let row1 = await insertIntoOnboardTable(onboardDemoDTO);
            combinedResult = row1
            
            if(onboardDemoDTO?.categories?.length>0) {
                let req2 = onboardDemoDTO?.categories;
                combinedResult.categories = [];
                let i = 0;
                for (const re of req2) {
                    
                    re.parentId = row1.id;
                    let row2 = await insertIntoOnboardTable(re);
                    console.log("combinedResult==",combinedResult)
                    combinedResult.categories.push(row2) 
                    
                    if(re?.categories && re?.categories?.length>0) {
                        let req3 = re?.categories;
                        combinedResult.categories[i].categories = [];
                        let j = 0;
                        for (const re2 of req3) {
                            re2.parentId = row2.id;
                            let row3 = await insertIntoOnboardTable(re2);
                            combinedResult.categories[i].categories.push(row3)
                            j++;
                        }
                    }
                    i++;
                }
                
            }
        }
      }
      
      console.log("===",combinedResult)
      // Send bot response
      res.json({ response: botResponse });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error generating response');
    }
  });

app.post('/cpgram-application-service/grievance/create', async (req, res) => {
    const { data } = req.body;
    try {
        let combinedResult = {}
      if(data) {
        let row1 = await insertIntoGrievanceTable(data);
        combinedResult = row1
      }
      
      // Send bot response
      res.status(200).json({
        success: true,
        message: 'Grievance registered successfully!',
        response: combinedResult
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error generating response');
    }
});

async function getCategoriesTableDataById(id) {
  result = await pool.query(
    `WITH RECURSIVE node_path AS (
        SELECT id, code, description, parent,stage
        FROM m_demo_cpgram_categories
        WHERE id in (
            SELECT A.id from (
                SELECT id, code, description,parent,stage
                FROM m_demo_cpgram_categories where id = $1
            ) A
        )
        UNION ALL
        SELECT h.id, h.code, h.description, h.parent, h.stage
        FROM m_demo_cpgram_categories h
        INNER JOIN node_path np ON h.id = np.parent
      )
      SELECT * 
      FROM node_path;`,
    [id]
  )
  return result?.rows;
      
}
async function getAssignToDetails(id) {
  let result = await pool.query(
    `SELECT * FROM m_user_master WHERE id = $1`,
    [id]
  )
  return result?.rows[0];
}
async function getGrievanceWorkflowDetails(greivance_table_id) {
  console.log("greivance_table_id==",greivance_table_id)
  let result = await pool.query(
    `SELECT 
      gw.id,
      gw.comments,
      gw.assign_by,
      gw.assign_to,
      gw.status,
      gw.created_date,
      gw.grievance_id,
      gw.action,
      um.name as employee_name,
      um.user_type as employee_type,
      um.email as employee_email,
      um.mobile_no as employee_mobile_no,
      um1.name as assign_by_employee_name,
      um1.user_type as assign_by_employee_type,
      um1.email as assign_by_employee_email,
      um1.mobile_no as assign_by_employee_mobile_no
      FROM t_grievance_workflow gw
      left JOIN m_user_master um ON CAST(gw.assign_to AS BIGINT) = um.id
      left JOIN m_user_master um1 ON CAST(gw.assign_by AS BIGINT) = um1.id
      WHERE gw.grievance_id=$1 order by gw.created_date asc`,
      [greivance_table_id]
  );
  return result?.rows;
}
app.post('/cpgram-application-service/grievance/search', async (req, res) => {
  const { data } = req.body;
  try {
    let combinedResult = {};
    let assign_to_details = {};
    let workflowDetails = [];
    if(data) {
      let row1 = await getGrievanceTableData(data);
      // console.log("row1==",row1)
      if(row1 && row1.length>0) {
        const mergedResults = await Promise.all(
        row1.map(async (r1)=>{
          if(r1?.assign_to) {
            assign_to_details= await getAssignToDetails(r1.assign_to);
          }
          if(r1?.id) {
            workflowDetails= await getGrievanceWorkflowDetails(r1.id);
          }
          if(r1.deptid) {
          let catData= await getCategoriesTableDataById(r1.deptid);
          let combineDescription = '';
          if(catData && catData.length>0) {
            let i=catData.length-1
            
            for(i; i>=0; i--) {
              if(combineDescription=='') {
                combineDescription = catData[i]?.description;
              } else {
                combineDescription =combineDescription+ " >> " +catData[i]?.description;
                
              }
            }
            r1.category = combineDescription
          
          }
          return {
            ...r1,
            category: combineDescription,
            assign_to_details: assign_to_details,
            workflowDetails: workflowDetails
          }
          }
          
        }))
        combinedResult = mergedResults
      }
      
    }
  
    // Send response
    res.status(200).json({
      success: true,
      message: 'Grievance feched successfully!',
      response: combinedResult
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating response');
  }
});
async function getOnBoardDataById(id) {
    const result = await pool.query(
        `SELECT id, code, description,parent,stage,field_details
            FROM m_demo_cpgram_categories 
            WHERE id = $1`,
        [id]
    );
    const combinedResults = [];
    for (const row of result.rows) {
        const secondQueryResult = await pool.query(
            `SELECT id, code, description,parent,stage
                FROM m_demo_cpgram_categories WHERE id = $1`,
            [row.parent]
        );
        for (const row1 of secondQueryResult.rows) {
            const thirdQueryResult = await pool.query(
                `SELECT id, code, description,parent,stage
                    FROM m_demo_cpgram_categories WHERE id = $1`,
                [row1.parent]
            );
            // Combine data from the first and second queries

            combinedResults.push({
                stage_3_details: row,
                stage_2_details: secondQueryResult.rows[0],
                stage_1_details: thirdQueryResult.rows[0],
            });
        }
        
    }
    return combinedResults;
    // return result
}
app.post('/cpgram-application-service/getOnboardDataById', async (req, res) => {
    const { id } = req.body;
  
    try {
      if(id) {
        let result = await getOnBoardDataById(id);
        // if(!onboardDemoDTO.id) {
            
        //     combinedResult = row1
        // }
        res.json({ response: result });
      } else {
        res.status(400).send('Id not found');
      }
      
      
      // Send bot response
    //   res.json({ response: botResponse });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error generating response');
    }
});
async function updateGrievance(data) {
  let combinedResults = {};
  const query1 = `
       UPDATE t_cpgram_grievance_new SET assign_by = $1,assign_to=$2,status=$3 WHERE id = $4
        RETURNING *;  -- Return all columns of the newly inserted row`;
    const values1 = [data?.assign_by, data?.assign_to,data?.status,
            data?.grievance_table_id];
    const result1 = await pool.query(query1, values1);
    // const query2 = `
    //    UPDATE t_grievance_workflow set action = $1, forwarded_by=$2 where id = $3
    //     RETURNING *;  -- Return all columns of the newly inserted row`;
    // const values2 = [data?.action, data?.assign_by, data?.workflow_table_id];
    // const result2 = await pool.query(query2, values2);
    let result3 = []
    // if(data?.action == 'Approve' && data?.action == 'Reject') {
    //   const query3 = `
    //    INSERT INTO t_grievance_workflow (assign_by,assign_to,status,comments,grievance_id,action)
    //     VALUES ($1, $2, $3,$4,$5,$6)
    //     RETURNING *;  -- Return all columns of the newly inserted row`;
    //   const values3 = [data?.assign_by, data?.assign_to,data?.status,data?.comments,
    //           data?.grievance_table_id,data?.action];
    //   result3 = await pool.query(query3, values3);
    // } else {
    //   const query3 = `
    //    INSERT INTO t_grievance_workflow (assign_by,assign_to,status,comments,grievance_id,action)
    //     VALUES ($1, $2, $3,$4,$5,$6)
    //     RETURNING *;  -- Return all columns of the newly inserted row`;
    //   const values3 = [data?.assign_by, data?.assign_to,data?.status,data?.comments,
    //           data?.grievance_table_id,data?.action];
    //   result3 = await pool.query(query3, values3);
    // }

    const query3 = `
       INSERT INTO t_grievance_workflow (assign_by,assign_to,status,comments,grievance_id,action)
        VALUES ($1, $2, $3,$4,$5,$6)
        RETURNING *;  -- Return all columns of the newly inserted row`;
      const values3 = [data?.assign_by, data?.assign_to,data?.status,data?.comments,
              data?.grievance_table_id,data?.action];
      result3 = await pool.query(query3, values3);
    
    combinedResults ={
      grievaneData : result1.rows,
      workflowData: result3.rows
    }
    return combinedResults;
}
app.post('/cpgram-application-service/grievance/update', async (req, res) => {
  const { data } = req.body;

  try {
    if(data) {
      let result = await updateGrievance(data);
      res.status(200).json({
        success: true,
        message: 'Grievance updated successfully!',
        response: result
      });
    } else {
      res.status(400).send('Id not found');
    }
    
    
    // Send bot response
  //   res.json({ response: botResponse });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating response');
  }
});
async function getDepartment(params) {
  const query1 = `
       SELECT id,description as name,orgcode,parent,stage,monitoringcode,field_details from m_demo_cpgram_categories WHERE parent = $1`;
    const values1 = [params?.parent];
    const result1 = await pool.query(query1, values1);
    return result1.rows;
}
app.post('/cpgram-application-service/getDepartments', async (req, res) => {
  const { data } = req.body;

  try {
    if(data) {
      let result = await getDepartment(data);
      res.status(200).json({
        success: true,
        message: 'Department fetched successfully!',
        response: result
      });
    } else {
      res.status(400).send('Id not found');
    }
    
    
    // Send bot response
  //   res.json({ response: botResponse });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating response');
  }
});
async function fetchUsersByUserTypes(params) {
  const query1 = `
       SELECT * from m_user_master WHERE organization = $1 and user_type = $2`;
    const values1 = [params?.orgcode, params?.user_type];
    const result1 = await pool.query(query1, values1);
    return result1.rows;
}
// /cpgram-application-service/user/fetchUsersByUserTypes
app.post('/cpgram-application-service/user/fetchUsersByUserTypes', async (req, res) => {
  const { data } = req.body;

  try {
    if(data) {
      let result = await fetchUsersByUserTypes(data);
      res.status(200).json({
        status: 200,
        message: 'User fetched successfully!',
        user: result
      });
    } else {
      res.status(400).send('Id not found');
    }
    
    
    // Send bot response
  //   res.json({ response: botResponse });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating response');
  }
});
// Start the server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
