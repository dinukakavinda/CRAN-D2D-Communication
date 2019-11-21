const functions = require('firebase-functions');
const {Storage} = require('@google-cloud/storage');
const os = require('os');
const path = require('path');
const cors = require('cors')({origin:true});
const Busboy = require('busboy');
const fs = require('fs');

const projectId = 'fyp-test-db';

const gcs = new Storage({
    projectId: projectId,
  });

var admin = require("firebase-admin");
var serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
credential: admin.credential.cert(serviceAccount),
databaseURL: "https://fyp-test-db.firebaseio.com/"

});







exports.onFileChange = functions.storage.object().onFinalize((object, context) => {

    const bucket = object.bucket;
    const contentType = object.contentType;
    const filePath = object.name;
    console.log('File change detected, funcion execution started');


    if(path.basename(filePath).startsWith('renamed-')){
        console.log('Already renamed the file')
        return;
    }

    const destBucket = gcs.bucket(bucket);
    const tmpFilePath = path.join(os.tmpdir(),path.basename(filePath));
    const metadata = {contentType:contentType};

    return destBucket.file(filePath).download({
        destination:tmpFilePath
    }).then(()=>{
        return destBucket.upload(tmpFilePath,{
        destination:'renamed-' + path.basename(filePath),
        metadata : metadata
        })
    });
});



exports.onFileDelete = functions.storage.object().onDelete(event => {
    console.log(event);
    return;
});



exports.onDataAdded = functions.database.ref('/message/{id}').onCreate((snap, context)=>{
    const data = snap.val();
    const newData = {
        msg : snap.key + ' - ' + data.msg.toUpperCase()
    };
    console.log(snap.key);
    return snap.ref.parent.child('copiedData').set(newData);
    
});


/* exports.uploadFile = functions.https.onRequest((req,res)=>{
    cors(req,res,()=>{
        if(req.method!='POST'){
            res.status(500).json({
                message: 'Not valid!'
            })
            return;
        }
    })

    const busboy = new Busboy({headers:req.headers});
    let uploadData = null;

    busboy.on('file',(fieldname,file,filename,encoding,mimetype)=>{
        const filepath = path.join(os.tmpdir(),filename);
        uploadData = {file:filepath , type:mimetype};
        file.pipe(fs.createWriteStream(filepath));
    });

    busboy.on('finish',()=>{
        const bucket = gcs.bucket('fyp-test-db.appspot.com')
        bucket.upload(uploadData.file,{
            uploadType:'media',
            metadata : {
                metadata:{
                    contentType:uploadData.type
                }
            }
        }).then((err,uploadedFile)=>{
            if(err){
                return res.status(500).json({
                    error:err
                })
            }

            res.status(200).json({
                message: 'It worked!'
            });

        });
    });


    
}); */







var db = admin.database();
var ref = db.ref("deviceDataStore");


exports.connData = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
      const usersRef = ref.child(`${req.body.deviceID}`);

      if (req.method !== 'POST') {
          return res.status(500).json({
              message: 'Not allowed'
          })
      } else {
          return usersRef.set(
            req.body
          ).then(() => {
              res.status(200).json({
                  message: req.body
              });
              return res.status(200)
          }).catch(error => {
              return res.status(500).send(error);
          })
      }
  })

});


///////////////////////////////Cloud Messagging//////////////////////////////////////////////////////////


exports.sendAdminNotification = functions.database.ref('/News/{pushId}').onCreate((snap,context) => {
    const news= snap.val();
         if(news.priority===1){
         const payload = {notification: {
             title: 'New news',
             body: `${news.title}`
             }
         };
         
    return admin.messaging().sendToTopic("News",payload)
        .then(function(response){
             console.log('Notification sent successfully:',response);
        }) 
        .catch(function(error){
             console.log('Notification sent failed:',error);
        });
        }
    });

  
    
//////////////     Read DB Value from   ////////////////////////


exports.optimumDevices = functions.https.onRequest((req, res) => {
    cors(req, res, () => {
        //const usersRef = ref.child(`${req.body.deviceID}`);
  
        if (req.method !== 'POST') {
            return res.status(500).json({
                message: 'Not allowed'
            })
        } else {
            const query = admin.database().ref("/deviceDataStore/")
           .orderByChild('batteryLevel')
           .limitToLast(2)

        query.on('value', function (snapshot) {
            var twoDevices = [];
            snapshot.forEach(function (childSnapshot) {
                var childKey = childSnapshot.key;
                var childData = childSnapshot.child("deviceID").val();
            
                twoDevices.push(childData);

                console.log(twoDevices);

                admin.database().ref("/News/newsid2").set({
                    "description" : "Test description",
                    "priority" : 1,
                    "title" : `${twoDevices}`
                });
            });
        });
           
        };
    });
  
  });


  

    

 
  





