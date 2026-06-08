# feathers-file-stream

```shell
npm i @artesa/feathers-file-stream
```

This package relies on a few peer dependencies. `@feathersjs/feathers` and `@feathersjs/errors` are already part of any Feathers app, so you normally have them.

If you use the S3 service (`ServiceFileStreamS3`), also install the AWS SDK packages:

```shell
npm i @aws-sdk/client-s3 @aws-sdk/lib-storage
```

If you use the Express middleware (`expressHandleIncomingStreams`, `expressSendStreamForGet`), also install Express and Multer:

```shell
npm i express multer
```

These peers are optional: the filesystem service (`ServiceFileStreamFS`) needs neither the AWS SDK nor Express/Multer.

## Usage with express & multer@next (multer v2) with fs storage

```ts
import multer from "multer"; // multer v2 (!)
import {
  expressHandleIncomingStreams,
  ServiceFileStreamFS,
  expressSendStreamForGet
} from "@artesa/feathers-file-stream";
const multerInstance = multer();

app.use(
  "/uploads",
  multerInstance.array("files"),
  expressHandleIncomingStreams({ field: "files", isArray: true }),
  new ServiceFileStreamFS({
    root: path.join(__dirname, "uploads")
  }),
  expressSendStreamForGet()
);
```

## Usage with express & multer@next (multer v2) with s3

```ts
import multer from "multer"; // multer v2 (!)
import { S3Client } from "@aws-sdk/client-s3";
import {
  expressHandleIncomingStreams,
  ServiceFileStreamS3,
  expressSendStreamForGet
} from "@artesa/feathers-file-stream";
const multerInstance = multer();
const s3 = new S3Client({
  credentials: {
    accessKeyId: "",
    secretAccessKey: ""
  }
});

app.use(
  "/uploads",
  multerInstance.array("files"), // looks for files and puts them in req.files
  expressHandleIncomingStreams({ field: "files", isArray: true }), // looks for req.files and puts them in req.body, so that it arrives at the service data object in the create method
  new ServiceFileStreamS3({
    s3: new S3Client({
      credentials: {
        accessKeyId: "",
        secretAccessKey: ""
      }
    }),
    bucket: "my-bucket"
  }),
  expressSendStreamForGet() // pipes the stream for a get request to the response
);
```

## Upload a file with stream

```ts
app.service("uploads").create({
  id: "my-file.txt", // the filename to save
  stream: fs.createReadStream("my-file.txt") // the stream to read
});
```
