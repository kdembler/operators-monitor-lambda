import { graphql } from "./gql";

export const GetTestVideo = graphql(`
  query GetVideos($limit: Int!, $offset: Int!) {
    videos(
      orderBy: [createdAt_DESC]
      limit: $limit
      offset: $offset
      where: {
        media: { isAccepted_eq: true }
        thumbnailPhoto: { isAccepted_eq: true }
      }
    ) {
      id
      media {
        ...StorageDataObjectFields
      }
      thumbnailPhoto {
        ...StorageDataObjectFields
      }
    }
  }

  fragment StorageDataObjectFields on StorageDataObject {
    id
    storageBag {
      distributionBuckets(
        where: { distributionBucket: { distributing_eq: true } }
      ) {
        distributionBucket {
          id
          operators {
            workerId
            metadata {
              nodeEndpoint
            }
          }
        }
      }
    }
  }
`);
