export class UpdateSpecimenStatusDto {
  status!:
    | 'available'
    | 'unavailable'
    | 'unsatisfactory'
    | 'entered-in-error';

  receivedAt?: string;

  acceptanceStatus?: 'pending' | 'accepted' | 'rejected';

  rejectionReason?: string;

  recollectionRequired?: boolean;

  receiverId?: string;

  receiverName?: string;

  note?: string;
} 
