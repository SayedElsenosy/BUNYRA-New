import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {FetchHttpHandler} from '@smithy/fetch-http-handler';
import type {PlanStorage} from './plan-files';
import {ServiceError} from './service';
export function planStorage():PlanStorage{
 const endpoint=process.env.AWS_ENDPOINT_URL_S3,region=process.env.AWS_REGION,accessKeyId=process.env.AWS_ACCESS_KEY_ID,secretAccessKey=process.env.AWS_SECRET_ACCESS_KEY;
 if(!endpoint||!region||!accessKeyId||!secretAccessKey)throw new ServiceError('STORAGE_NOT_CONFIGURED',503);
 const client=new S3Client({endpoint,region,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey},requestHandler:new FetchHttpHandler(),requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:2});
 return {async put(key,data,mime){await client.send(new PutObjectCommand({Bucket:'project-plans',Key:key,Body:data,ContentType:mime}));},async get(key){const r=await client.send(new GetObjectCommand({Bucket:'project-plans',Key:key}));if(!r.Body)throw new ServiceError('NOT_FOUND',404);return r.Body.transformToByteArray();}};
}
